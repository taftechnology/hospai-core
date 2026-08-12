# Housekeeping Module Mechanism Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the §5 module mechanism using `pms.housekeeping` — kernel contract + static registries, extract room-status / assign / assignment-read into the module, ship a read-only SPA board via `ui.manifest`, and gate the shape.

**Architecture:** Sync use-case functions receive a txn-scoped `ModuleTxnCtx` built only inside `transactionSync`+`runIdempotent` via one private `moduleTxnCtx` helper (provisional extras pre-bound). Server/UI manifests split under `src/`. Reads take bare `SqlStorageLike`. `Sync<T>` lives in contracts and makes async use cases a compile error.

**Tech Stack:** pnpm workspaces, TypeScript, vitest, `@cloudflare/vitest-pool-workers`, React 19 + Vite (`web-pms`), existing PropertyDO / `REPLAY_DISPATCH` / react-query patterns.

**Spec:** [`docs/superpowers/specs/2026-08-11-housekeeping-module-mechanism-design.md`](../specs/2026-08-11-housekeeping-module-mechanism-design.md) (Accepted)

## Global Constraints

- Never put `businessDate` / open business date on `ModuleTxnCtx` (future name: `openBusinessDate` only).
- Module never receives `ActorContext`, `IdempotencyKey`, `ProvisionalContext`, or the DO stub.
- `listRooms` stays in PropertyDO; only `readHousekeepingAssignments` moves into the module.
- `tryAssignRoom` / `rooms.create` / `rooms.update` stay put.
- SPA board: read-only + room-status mutations; **no assign UI**.
- Characterization tests for provisional outbox extras on the three moved mutations **before** extraction.
- `assignee_ref`: `^staff_[A-Za-z0-9_-]+$`; migrate `hk_*` fixtures; pre-launch only.
- Manifests under `src/`; React is peer+devDep on the module; `web-pms` must not depend on `@hospai/kernel`.
- Write-set check is `declared ⊇ actual` (overlap allowed); `schema.tables = ['housekeeping_assignment']`, `writes = ['room', 'housekeeping_assignment']`.
- TDD where the plan shows RED steps; keep existing rooms / degraded suites green through extraction.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/contracts/src/sync.ts` | `Sync<T>` |
| `packages/contracts/src/sync.compile-time.ts` | `@ts-expect-error` harness (money pattern) |
| `packages/contracts/src/module-ui.ts` | Shared nav/route contribution types + `order` |
| `packages/contracts/src/staff-ref.ts` | `STAFF_REF_RE` + `isStaffRef` |
| `packages/do-runtime/src/idempotency.ts` | `runIdempotent` execute: `() => Sync<T>` |
| `packages/do-runtime/src/idempotency.compile-time.ts` | Reject async execute |
| `packages/kernel/src/define-module.ts` | Zod manifest schema + `defineModule` |
| `packages/kernel/src/module-txn.ts` | `ModuleTxnCtx` + sync use-case types |
| `packages/kernel/src/registry.ts` | Hand-maintained `MODULE_REGISTRY` |
| `packages/kernel/src/index.ts` | Re-exports |
| `modules/pms/housekeeping/**` | Full module (minus `jobs/`) |
| `scripts/module-manifests-check.mjs` | Registry + write-set + pairing + `--self-test` |
| `apps/pms-core/src/property-do.ts` | `moduleTxnCtx` helper; thin delegations |
| `apps/pms-core/test/degraded-mode.spec.ts` | Characterization extras on tests 22/23 (+ bulk if present) |
| `apps/web-pms/src/shell/nav.ts` | Core `order` fields |
| `apps/web-pms/src/shell/module-ui-registry.ts` | Concatenate UI manifests |
| `apps/web-pms/src/App.tsx` | Housekeeping route |
| `packages/client-core/src/api.ts` | `listRooms`, `listHousekeepingAssignments`, `updateRoomStatus` |
| `packages/contracts/src/commands/catalog.ts` | Roster family `notes` |
| `.github/workflows/ci.yml` | `check:module-manifests` + existing `--self-test`s |
| `package.json` | `check:module-manifests` script |
| `README.md` | Test count |

---

### Task 1: `Sync<T>` + constrain `runIdempotent`

**Files:**
- Create: `packages/contracts/src/sync.ts`
- Create: `packages/contracts/src/sync.compile-time.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/do-runtime/src/idempotency.ts`
- Create: `packages/do-runtime/src/idempotency.compile-time.ts`

**Interfaces:**
- Produces: `export type Sync<T> = T extends PromiseLike<unknown> ? never : T`
- Produces: `runIdempotent<T>(sql, idem, execute: () => Sync<T>): T`

- [ ] **Step 1: Add `Sync` + compile-time harness in contracts**

```ts
// packages/contracts/src/sync.ts
export type Sync<T> = T extends PromiseLike<unknown> ? never : T;
```

```ts
// packages/contracts/src/sync.compile-time.ts
import type { Sync } from './sync.js';

function _compileTimeChecks(): void {
  const ok: Sync<number> = 1;
  void ok;
  // @ts-expect-error Promise is not Sync
  const bad: Sync<Promise<number>> = Promise.resolve(1);
  void bad;
}
void _compileTimeChecks;
```

Export from `index.ts`. Ensure `tsconfig` includes `*.compile-time.ts` (money already does via `include: ["src"]`).

- [ ] **Step 2: Constrain `runIdempotent`**

```ts
import type { Sync } from '@hospai/contracts';

export function runIdempotent<T>(
  sql: SqlStorageLike,
  idem: IdempotencyKey,
  execute: () => Sync<T>,
): T {
  // body unchanged
}
```

```ts
// packages/do-runtime/src/idempotency.compile-time.ts
import type { IdempotencyKey } from '@hospai/contracts';
import { runIdempotent, type SqlStorageLike } from './index.js';

declare const sql: SqlStorageLike;
declare const idem: IdempotencyKey;

function _compileTimeChecks(): void {
  runIdempotent(sql, idem, () => 1);
  // @ts-expect-error async execute must not typecheck
  runIdempotent(sql, idem, async () => 1);
}
void _compileTimeChecks;
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter @hospai/contracts typecheck && pnpm --filter @hospai/do-runtime typecheck && pnpm --filter @hospai/do-runtime test`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/src/sync.ts packages/contracts/src/sync.compile-time.ts packages/contracts/src/index.ts packages/do-runtime/src/idempotency.ts packages/do-runtime/src/idempotency.compile-time.ts
git commit -m "feat(contracts): Sync<T> blocks async runIdempotent execute"
```

---

### Task 2: Kernel module contract + empty registry spike hook

**Files:**
- Create: `packages/kernel/src/define-module.ts`
- Create: `packages/kernel/src/module-txn.ts`
- Create: `packages/kernel/src/registry.ts`
- Modify: `packages/kernel/src/index.ts`
- Create: `packages/contracts/src/module-ui.ts`
- Create: `packages/contracts/src/staff-ref.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/kernel/package.json` (add zod if not already; already has zod)

**Interfaces:**
- Produces: `ModuleManifest`, `defineModule`, `MODULE_REGISTRY`, `ModuleTxnCtx`, `SyncUseCase`, `STAFF_REF_RE`, `ModuleUiManifest` types

- [ ] **Step 1: Staff ref + UI types in contracts**

```ts
// packages/contracts/src/staff-ref.ts
export const STAFF_REF_RE = /^staff_[A-Za-z0-9_-]+$/;
export function isStaffRef(value: string): boolean {
  return STAFF_REF_RE.test(value);
}
```

```ts
// packages/contracts/src/module-ui.ts
import type { PropertyScopedPermission } from './permissions.js';

export type ModuleUiNavEntry = {
  id: string;
  label: string;
  path: string;
  order: number;
  permission?: PropertyScopedPermission;
};

export type ModuleUiManifest = {
  moduleId: string;
  nav: ModuleUiNavEntry[];
  // routes stay in the module package (lazy components); SPA imports them from /ui
};
```

- [ ] **Step 2: `defineModule` + txn types in kernel**

```ts
// packages/kernel/src/module-txn.ts
import type { Sync } from '@hospai/contracts';

/** Structural — matches do-runtime SqlStorageLike without a kernel→do-runtime dep. */
export type ModuleSql = {
  exec(query: string, ...bindings: unknown[]): { toArray(): unknown[] };
};

export type ModuleOutboxEventInput = {
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
};

export type ModuleTxnCtx = {
  sql: ModuleSql;
  appendOutbox: (evt: ModuleOutboxEventInput) => void;
  orgId: string;
  propertyId: string;
};

export type SyncUseCase<In, Out> = (ctx: ModuleTxnCtx, input: In) => Sync<Out>;
export type SyncRead<Filters, Out> = (sql: ModuleSql, filters: Filters) => Sync<Out>;
```

```ts
// packages/kernel/src/define-module.ts
import { z } from 'zod';

export const ModuleManifestSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  entitlement: z.string().min(1),
  requires: z.array(z.string()).default([]),
  schema: z.object({
    prefix: z.string().nullable().optional(),
    tables: z.array(z.string()),
  }),
  writes: z.array(z.string()),
  publishes: z.array(z.string()).default([]),
  subscribes: z.array(z.object({ event: z.string(), handler: z.string() })).default([]),
  permissions: z.array(z.string()).default([]),
  meters: z.array(z.string()).default([]),
  lifecycle: z
    .object({
      onActivate: z.string().optional(),
      onDeactivate: z.string().optional(),
      onPurge: z.string().optional(),
    })
    .optional(),
});

export type ModuleManifest = z.infer<typeof ModuleManifestSchema>;

export function defineModule(mod: ModuleManifest): ModuleManifest {
  return ModuleManifestSchema.parse(mod);
}
```

```ts
// packages/kernel/src/registry.ts
import type { ModuleManifest } from './define-module.js';

/** Hand-maintained. Task 3 appends housekeeping. */
export const MODULE_REGISTRY: readonly ModuleManifest[] = [];
```

Update `index.ts`: remove stub `defineModule`; export real API; keep or delete `defineConfig` per Task 9.

- [ ] **Step 3: Kernel unit test — defineModule rejects empty id**

```ts
import { describe, expect, it } from 'vitest';
import { defineModule } from './define-module.js';

describe('defineModule', () => {
  it('rejects missing writes', () => {
    expect(() =>
      defineModule({
        id: 'pms.housekeeping',
        version: '0.0.1',
        entitlement: 'pms.core',
        schema: { tables: ['housekeeping_assignment'] },
      } as never),
    ).toThrow();
  });
});
```

- [ ] **Step 4: Verify + commit**

Run: `pnpm --filter @hospai/kernel test && pnpm --filter @hospai/contracts typecheck`

```bash
git commit -m "feat(kernel): defineModule schema, ModuleTxnCtx, empty registry"
```

---

### Task 3: Scaffold `@hospai/pms-housekeeping` + JSX/export spike

**Files:**
- Create: `modules/pms/housekeeping/package.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `modules/pms/housekeeping/src/module.manifest.ts`
- Create: `modules/pms/housekeeping/src/ui.manifest.ts`
- Create: `modules/pms/housekeeping/src/ui/HousekeepingApp.tsx` (placeholder)
- Create: `modules/pms/housekeeping/src/index.ts` (server export = manifest + later application)
- Create: `modules/pms/housekeeping/src/ui.ts` (UI export entry)
- Modify: `packages/kernel/src/registry.ts`
- Modify: `apps/web-pms/package.json` (dep on module)
- Modify: `apps/pms-core/package.json` (dep on module + kernel if missing)

**Interfaces:**
- Produces: `@hospai/pms-housekeeping` → server manifest; `@hospai/pms-housekeeping/ui` → ui manifest + app
- Produces: `MODULE_REGISTRY` length 1

- [ ] **Step 1: Package.json with dual exports**

```json
{
  "name": "@hospai/pms-housekeeping",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./ui": {
      "types": "./dist/ui.d.ts",
      "import": "./dist/ui.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@hospai/contracts": "workspace:*",
    "@hospai/kernel": "workspace:*",
    "@hospai/do-runtime": "workspace:*"
  },
  "peerDependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.1.2",
    "@types/react-dom": "^19.1.2",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "typescript": "^5.8.2",
    "vitest": "^3.0.9"
  }
}
```

`tsconfig.json`: extend base; `rootDir: "src"`; `jsx: "react-jsx"`; `include: ["src"]`.

- [ ] **Step 2: Manifests under `src/`**

```ts
// src/module.manifest.ts
import { defineModule } from '@hospai/kernel';

export default defineModule({
  id: 'pms.housekeeping',
  version: '0.0.1',
  entitlement: 'pms.core',
  requires: [],
  schema: { prefix: null, tables: ['housekeeping_assignment'] },
  writes: ['room', 'housekeeping_assignment'],
  publishes: ['housekeeping.assigned', 'room.status_changed'],
  subscribes: [],
  permissions: ['housekeeping:read', 'housekeeping:write'],
  meters: [],
});
```

```ts
// src/ui.manifest.ts
import type { ModuleUiManifest } from '@hospai/contracts';

export const housekeepingUi = {
  moduleId: 'pms.housekeeping',
  nav: [
    {
      id: 'housekeeping',
      label: 'Housekeeping',
      path: '/housekeeping',
      order: 25,
      permission: 'housekeeping:read',
    },
  ],
} as const satisfies ModuleUiManifest;
```

```tsx
// src/ui/HousekeepingApp.tsx — spike placeholder
export function HousekeepingApp() {
  return <p>housekeeping</p>;
}
```

```ts
// src/index.ts
export { default as housekeepingManifest } from './module.manifest.js';
export { default } from './module.manifest.js';

// src/ui.ts
export { housekeepingUi } from './ui.manifest.js';
export { HousekeepingApp } from './ui/HousekeepingApp.js';
```

- [ ] **Step 3: Register in kernel**

```ts
import housekeeping from '@hospai/pms-housekeeping';
export const MODULE_REGISTRY = [housekeeping] as const;
```

Add `@hospai/pms-housekeeping` dependency to `packages/kernel/package.json`.

- [ ] **Step 4: Spike verify (Worker vs Vite)**

Run: `pnpm --filter @hospai/pms-housekeeping build && pnpm --filter @hospai/kernel build && pnpm --filter @hospai/pms-core build && pnpm --filter @hospai/web-pms build`

Assert:
- `pms-core` build does not fail on JSX.
- In `web-pms`, temporary import of `@hospai/pms-housekeeping/ui` resolves (wire into registry in Task 7; for spike, a one-line import in `main.tsx` or a tiny test file is enough, then remove if not yet wired).

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(housekeeping): scaffold module manifests and UI export spike"
```

---

### Task 4: `check:module-manifests` with `--self-test`

**Files:**
- Create: `scripts/module-manifests-check.mjs`
- Modify: `package.json` (`check:module-manifests`)
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: gate asserting registry membership, `moduleId` pairing, `writes` ⊇ scanned infrastructure writes, read-path write-free

- [ ] **Step 1: Implement checker (follow `forbidden-body-check.mjs` self-test idiom)**

Assertions:
1. Every `modules/pms/*/src/module.manifest.ts` that exists is imported by `packages/kernel/src/registry.ts` (string match on package name / id).
2. For each such module, if `src/ui.manifest.ts` exists, `moduleId` equals server `id`.
3. Grep `modules/pms/*/src/infrastructure/**/*.ts` for `\b(INSERT|UPDATE|DELETE)\b` table names; each must appear in that module's `writes` array in the manifest source.
4. Grep `**/application/**/*read*` and `**/infrastructure/**/*read*` (or files under `**/reads/**`) — no INSERT/UPDATE/DELETE. For housekeeping, put reads in `src/application/read-assignments.ts` and mark path convention in script comments.
5. `--self-test`: fixture strings that must pass/fail as listed in spec §4.6.

- [ ] **Step 2: Wire npm + CI**

```json
"check:module-manifests": "pnpm --filter @hospai/kernel build && node scripts/module-manifests-check.mjs"
```

CI: add `pnpm check:module-manifests` after other checks.

Also add to CI (this chunk's fold):  
`node scripts/forbidden-body-check.mjs --self-test` and `node scripts/do-transport-guards-check.mjs --self-test` (scripts that already support it).

- [ ] **Step 3: Run**

```bash
node scripts/module-manifests-check.mjs --self-test
pnpm check:module-manifests
```

Expected: OK

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: add check:module-manifests with self-test"
```

---

### Task 5: Characterization tests + `staff_` fixture migration (before extract)

**Files:**
- Modify: `apps/pms-core/test/degraded-mode.spec.ts` (tests 22, 23; add bulk if a replay case exists)
- Modify: `apps/pms-core/test/rooms.spec.ts`, `rooms-routes.spec.ts` (`hk_*` → `staff_*`)
- Modify: any other `hk_` assignees in tree

**Interfaces:**
- Produces: failing-if-extras-dropped assertions on outbox payloads after replay

- [ ] **Step 1: Extend test 22 (rooms.update_status) — RED if extras missing**

After `dispatchPendingBatch` and status assert, mirror test 2:

```ts
const payloads = await stub.listOutboxPayloads();
const statusEvt = payloads.find((p) => p.eventType === 'room.status_changed');
expect(statusEvt).toBeTruthy();
const payload = JSON.parse(statusEvt!.payload) as {
  provisional?: boolean;
  issuedAt?: string;
  replayedAt?: string;
};
expect(payload.provisional).toBe(true);
expect(payload.issuedAt).toBe(sent[0]!.provisional.issuedAt);
expect(typeof payload.replayedAt).toBe('string');
```

- [ ] **Step 2: Same for test 23 (`housekeeping.assigned`)**

- [ ] **Step 3: If `rooms.bulk_update_status` has a degraded replay test, add the same; otherwise add a focused DO/HTTP replay case for bulk that asserts extras on each emitted `room.status_changed` (spec: one DO integration assert per moved mutation).**

- [ ] **Step 4: Migrate fixtures `hk_alice`→`staff_alice`, `hk_bob`→`staff_bob`, `hk_deg`→`staff_deg`**

Do **not** yet enforce `isStaffRef` at the boundary — that lands with extract (Task 6) so characterization still passes on pre-extract code. Fixture strings alone are fine until Task 6 rejects `hk_*`.

- [ ] **Step 5: Run degraded + rooms tests; commit**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/degraded-mode.spec.ts test/rooms.spec.ts test/rooms-routes.spec.ts
git commit -m "test(pms-core): characterize provisional outbox extras for room/hk replay"
```

---

### Task 6: Extract use cases + `moduleTxnCtx` + thin DO + `assignee_ref` gate

**Files:**
- Create: `modules/pms/housekeeping/src/domain/assignee-ref.ts` (re-export/wrap `isStaffRef`)
- Create: `modules/pms/housekeeping/src/domain/room-status.ts` (allowed statuses set)
- Create: `modules/pms/housekeeping/src/application/update-room-status.ts`
- Create: `modules/pms/housekeeping/src/application/bulk-update-room-status.ts`
- Create: `modules/pms/housekeeping/src/application/assign-housekeeping.ts`
- Create: `modules/pms/housekeeping/src/application/read-assignments.ts`
- Create: `modules/pms/housekeeping/src/infrastructure/` only if SQL helpers need a home; otherwise keep SQL in application for this first module (YAGNI) — prefer `application/` calling `ctx.sql.exec` directly to match current DO style
- Create: module unit tests with a small `MemorySql`
- Modify: `apps/pms-core/src/property-do.ts`
- Modify: `apps/pms-core/src/v1-dispatch.ts` if assign body validation needs `isStaffRef` at edge
- Export use cases from `modules/pms/housekeeping/src/index.ts`

**Interfaces:**
- Consumes: `ModuleTxnCtx`, `SyncUseCase`, `SyncRead`, `isStaffRef`
- Produces: sync functions; DO RPCs unchanged in signature

- [ ] **Step 1: Module unit tests (RED)**

Test `assignHousekeeping` with MemorySql: upserts row, calls `appendOutbox` with `housekeeping.assigned` and `propertyId` from ctx (no provisional fields — binder is DO-side).

Test `isStaffRef` rejects `hk_alice`, `user_x`, `Alice`, `''`.

- [ ] **Step 2: Implement sync use cases**

Move SQL from `tryUpdateRoomStatus` / `tryBulkUpdateRoomStatus` / `tryAssignHousekeeping` / `readHousekeepingAssignments` bodies. Use cases throw domain errors or return result unions matching current DO mapping — pick one style and map in DO (prefer throw + catch map to preserve DO error mapping).

`assignHousekeeping` re-asserts `isStaffRef(input.assigneeRef)`.

`readAssignments(sql, { businessDate })` — bare sql; validate date format in DO preamble or use case (sync).

- [ ] **Step 3: Add `moduleTxnCtx` private helper on PropertyDO**

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
        eventId: evt.eventId,
        eventType: evt.eventType,
        payload: { ...evt.payload, ...this.statusChangeOutboxExtras(provisional) },
      }),
    orgId,
    propertyId,
  };
}
```

Confirm `appendPropertyOutbox` signature accepts this shape (adapt if it wraps `appendOutbox` with source).

- [ ] **Step 4: Thin the three mutations + readHousekeepingAssignments**

Preamble unchanged (permission, lanes, format checks). Inside txn:

```ts
return assignHousekeeping(this.moduleTxnCtx(orgId, propertyId, provisional), input);
```

Reject invalid `assigneeRef` in preamble with a stable wire error (add `INVALID_ASSIGNEE_REF` to contracts if needed, or reuse a generic validation error already used for `invalid_business_date` style string unions).

- [ ] **Step 5: Run characterization + rooms + module unit tests**

Expected: provisional extras still pass; fixtures `staff_*` accepted; `hk_*` rejected on assign.

- [ ] **Step 6: Commit**

```bash
git commit -m "refactor(housekeeping): extract sync use cases behind moduleTxnCtx"
```

---

### Task 7: SPA registry + read-only board + room status mutation

**Files:**
- Modify: `apps/web-pms/src/shell/nav.ts` (add `order` 10/20/30/40/50)
- Create: `apps/web-pms/src/shell/module-ui-registry.ts`
- Modify: `apps/web-pms/src/shell/AppShell.tsx` (use `ALL_NAV`)
- Modify: `apps/web-pms/src/auth/me.ts` / tests for nav filtering with order
- Modify: `apps/web-pms/src/App.tsx`
- Create: `modules/pms/housekeeping/src/ui/HousekeepingBoard.tsx` (or flesh out `HousekeepingApp`)
- Modify: `packages/client-core/src/api.ts` — `listRooms`, `listHousekeepingAssignments`, `updateRoomStatus`
- Tests: nav filter includes/hides housekeeping; board screen smoke test

**Interfaces:**
- Consumes: `@hospai/pms-housekeeping/ui`
- Produces: `/housekeeping` board composing two GETs; status POST

- [ ] **Step 1: Core nav orders + registry**

```ts
export type NavEntry = {
  id: string;
  label: string;
  path: string;
  order: number;
  permission?: PropertyScopedPermission;
};

export const NAV_ENTRIES: NavEntry[] = [
  { id: 'arrivals', label: 'Arrivals', path: '/arrivals', order: 10, permission: 'reservations:read' },
  { id: 'in-house', label: 'In-house', path: '/in-house', order: 20, permission: 'reservations:read' },
  { id: 'departures', label: 'Departures', path: '/departures', order: 30, permission: 'reservations:read' },
  { id: 'book', label: 'Book', path: '/book', order: 40, permission: 'reservations:write' },
  { id: 'staff', label: 'Staff', path: '/staff', order: 50, permission: 'staff:read' },
];
```

```ts
// module-ui-registry.ts
import { housekeepingUi } from '@hospai/pms-housekeeping/ui';
import { NAV_ENTRIES as CORE_NAV, type NavEntry } from './nav.js';

export const MODULE_UI = [housekeepingUi];

export const ALL_NAV: NavEntry[] = [...CORE_NAV, ...MODULE_UI.flatMap((m) => [...m.nav])].sort(
  (a, b) => a.order - b.order,
);
```

AppShell imports `ALL_NAV`. Update `me.test.ts` accordingly.

- [ ] **Step 2: client-core methods** matching existing route shapes (`GET /rooms`, `GET /housekeeping/assignments?businessDate=`, `POST /rooms/:id/status`).

- [ ] **Step 3: Board UI**

- Date input for `businessDate` (default: property business date from `getProperty` if available, else today).
- Table: rooms with status; assignment assigneeRef when present for that date.
- Status control: select + save calling `updateRoomStatus` (idempotency key via existing keyStore pattern).
- **No assign form.**

- [ ] **Step 4: Route**

```tsx
<Route path="housekeeping/*" element={<HousekeepingApp />} />
```

Or render `HousekeepingApp` from the module package.

- [ ] **Step 5: Tests + commit**

```bash
pnpm --filter @hospai/web-pms test
pnpm --filter @hospai/client-core test
git commit -m "feat(web-pms): housekeeping board from ui.manifest registry"
```

---

### Task 8: Catalog notes for `housekeeping.staff_*` family

**Files:**
- Modify: `packages/contracts/src/commands/catalog.ts`
- Modify: `packages/contracts/src/register.test.ts` (assert notes present)

- [ ] **Step 1: Shared notes constant**

```ts
export const HOUSEKEEPING_STAFF_FAMILY_NOTES =
  'Roster family (Staff-class PII / per-staff key), distinct from membership staff.* ' +
  '(access revocation). §4.8: staff exit is not deletion — identity is pseudonymized and ' +
  'employment follows statutory retention. Command semantics owned by the roster spec. ' +
  'Id rename (e.g. housekeeping.roster_*) deferred while unrouted.';
```

Attach `notes: HOUSEKEEPING_STAFF_FAMILY_NOTES` to `housekeeping.staff_add|status|delete|update`.

- [ ] **Step 2: Register test + commit**

```bash
git commit -m "docs(contracts): record housekeeping.staff_* §4.8 family notes"
```

---

### Task 9: README, `defineConfig`, CI self-tests fold-up

**Files:**
- Modify: `README.md` (replace "275+ tests" with measured count from `pnpm test` / known suite size ~791 or recount)
- Modify: `packages/kernel/src/index.ts` — delete unused `defineConfig` **or** document as thin re-export over `CONFIG_REGISTER` (prefer delete if zero product call sites; keep `validateConfigWrite`)
- Verify CI includes Task 4 self-tests

- [ ] **Step 1: Grep `defineConfig` from `@hospai/kernel`**

If unused, remove export and dead code.

- [ ] **Step 2: Recount tests; update README**

- [ ] **Step 3: Final verification**

```bash
pnpm build
pnpm check:module-manifests
pnpm check:forbidden-bodies -- # plus self-test in CI
pnpm typecheck
pnpm --filter @hospai/pms-core exec vitest run test/degraded-mode.spec.ts test/rooms.spec.ts
pnpm --filter @hospai/web-pms test
pnpm --filter @hospai/pms-housekeeping test
```

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: wire module-manifest CI and refresh README test count"
```

---

## Acceptance checklist (from spec §1.4)

- [ ] Second module can register with only a registry import line (no kernel internals edit)
- [ ] Board renders from SPA registry; nav gated on `housekeeping:read`
- [ ] Three DO RPCs unchanged for `REPLAY_DISPATCH`; characterization extras green post-extract
- [ ] `property-do.ts` net line delta negative for moved methods
- [ ] `listRooms` still defined in PropertyDO
- [ ] No assign UI; `assignee_ref` enforced server-side as `staff_…`

## Plan self-review

| Spec requirement | Task |
|---|---|
| Sync compile-time | 1 |
| Kernel defineModule + registry | 2–3 |
| Manifests under src/ + JSX spike | 3 |
| check:module-manifests + self-test | 4 |
| Characterization before extract | 5 |
| moduleTxnCtx helper + extract | 6 |
| assignee_ref pin | 6 (+ fixtures in 5) |
| SPA ui.manifest board read-only | 7 |
| Catalog notes | 8 |
| CI self-tests / README / defineConfig | 9 |
| listRooms stays | 6 (explicit non-move) |
| No businessDate on ctx | 6 |
| schema.tables ≠ writes | 3 manifest |
