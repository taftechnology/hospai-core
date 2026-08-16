# Audit Phase G — structural cleanup (G1–G5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Draft (plan writer, 2026-08-16)
>
> **Spec/plan writers do not commit.** Implementers commit per task. Work on `main`. No push.

**Goal:** Close audit Phase **G** items **G1**–**G5** — consolidate seven route guards into `<PermissionRoute>`, extract `commandEnvelope` for all `invokePropertyDo` preambles, generalize `commandErrorResponse` + merge guest/roster mappers, add `id: RouteId` to `V1_ROUTES` with id-keyed drift check, and migrate 13 `panel` + 2 `badge` literals to ui-kit with ratchet extension. **Frozen head counts unchanged; G4 sanctioned shape change only.**

**Architecture:** contracts + permissions script (**G4**) → web-pms route tree (**G1**) → web-pms/ui-kit CSS (**G5**) → pms-core envelope batches (**G2-1…G2-8**, needs `RouteId`) → pms-core error helper (**G3**, same `v1-dispatch.ts`). **Strictly sequential** end-to-end per reviewer lock — no parallel G4∥G1 on one working tree.

**Tech Stack:** React 19 + React Router (`apps/web-pms`), Cloudflare Workers dispatch (`apps/pms-core`), `@hospai/contracts`, `@hospai/ui-kit`, vitest + root `pnpm test:local`.

**Spec:** `docs/superpowers/specs/2026-08-16-audit-phase-g-structural-design.md` (Locks 1–5 normative).

---

## Frozen heads (state which move)

| Head | Current | This chunk |
|---|---|---|
| `COMMAND_CATALOG` | length **89** | **89** — unchanged |
| `AUDIT_WRITER_COMMAND_IDS.size` | **63** | **63** |
| `V1_HTTP_ROUTE_AUDIT` | length **144**; `[143].id === 'get_city_ledger_statement'` | **144** — count unchanged |
| `V1_ROUTES` (dispatch) | length **144**; no `id` field today | **144** — count unchanged; **G4 adds `id: RouteId` per entry** (sanctioned shape change) |
| `RouteId` type export | — | **New additive export** from `packages/contracts` (G4) |
| `PROPERTY_SCHEMA_HEAD` | **34** | **34** — no migration |
| `NIGHT_AUDIT_STEPS` | length **8**; `[3] === 'AUTO_TRANSFER'` | **8** — unchanged |
| `idempotency.ts` `export const` count | **158** | **158** — unchanged |

Tree verified 2026-08-16. **No DDL** this phase — `pnpm generate:ddl && pnpm check:ddl` is confirm-only in final verify.

---

## Sequencing gate (read before starting)

Phases **A**, **B**, **C**, **D**, **E**, and **F** **must** be landed — typed error channel, user-facing copy, and performance fixes are trustworthy.

| After this plan | Do not start |
|---|---|
| Lock 4 (G4) — `RouteId` + id-keyed `check:permissions` | G2 envelope adoption (needs `RouteId` compile-time) |
| Lock 1 (G1) — nested `PermissionRoute` tree | G5 screen migrations before G1 route tree stable |
| Lock 5 (G5) — ui-kit ratchet + CSS cleanup | Phase **H** audit items |
| Lock 2 (G2) — all 8 envelope batches | G3 error helper (same `v1-dispatch.ts`) |
| Lock 3 (G3) — `commandErrorResponse` + mapper merge | Server error status changes (Phase D locked) |
| All §Verification commands green | DO / schema / catalog changes; push |

**Locked execution order (reviewer-confirmed — run sequentially):**

```
G4 → G1 → G5 → G2-1 → G2-2 → G2-3 → G2-4 → G2-5 → G2-6 → G2-7 → G2-8 → G3 → verify
```

Although spec §3 marks **G4 ∥ G1** parallel-safe, run **sequentially (G4 first)** to avoid Phase E-style working-tree collisions. All **G2 batches** and **G3** touch `v1-dispatch.ts` — **strictly sequential**, one commit per batch.

**TDD order:** Task 1 (G4 reorder-verify manual + typecheck) → Task 2 (G1 PermissionRoute red-first) → Task 3 (G5 ratchet baseline) → Tasks 4–11 (G2 mechanical) → Task 12 (G3 mechanical) → Task 13 (full verification).

---

## Open decisions (locked — do not re-litigate)

### D1 — Lock 4 (G4): `RouteId` + id-keyed drift (spec §2 Lock 4)

**Locked:** Extend `V1RouteDef` base with **`id: RouteId`** on **every** `V1_ROUTES` entry (`apps/pms-core/src/v1-dispatch.ts:7784+`). Each `id` **must equal** the corresponding `V1_HTTP_ROUTE_AUDIT` entry's `id`.

**Contracts export:**

```ts
export type RouteId = (typeof V1_HTTP_ROUTE_AUDIT)[number]['id'];
```

Re-export via existing `packages/contracts/src/index.ts` barrel (`export * from './v1-http-routes.js'`).

**`permissions-check.mjs` (locked):**

1. Parse `id:\s*'([^']+)'` from each route block.
2. Build `Map<string, parsedRoute>` keyed by `id`.
3. For each audit entry, lookup by `audit.id`; compare `scope`, `permission`, `commandId`, `entitlement`.
4. **Keep** length equality: `parsedRoutes.length === V1_HTTP_ROUTE_AUDIT.length` (**144**).
5. **Remove** index-based loop at `:79–88`.

**`invoke-property-do.ts`:** `routeId: RouteId` (import from `@hospai/contracts`).

**Reorder verification (locked, manual — not CI):** Document in Task 1 Step 4 / PR notes: swap two adjacent `V1_ROUTES` entries with identical metadata → `pnpm check:permissions` stays green; mutate one field by id → per-id drift error.

### D2 — Lock 1 (G1): `<PermissionRoute>` + nested routes (spec §2 Lock 1)

**Locked component** — `apps/web-pms/src/auth/PermissionRoute.tsx`:

- Props: `permission: PropertyScopedPermission`, optional `fallback` default **`'/arrivals'`**.
- **Always `<Outlet/>` on pass** — never render screen directly; **no `children` prop**.
- **`authority.kind === 'unknown'` → `<Outlet/>`** (fail-open — do **not** fix).
- Pending / non-authority shell → `null`.

**Nested routes in `App.tsx` (locked):**

| Path | Permission | Nested element |
|---|---|---|
| `book` | `reservations:write` | `<BookingScreen />` |
| `night-audit` | `night_audit:run` | `<NightAuditScreen />` |
| `staff` | `staff:read` | `<StaffScreen />` |
| `roster` | `roster:write` | `<RosterScreen />` |
| `housekeeping/*` | `housekeeping:read` | `<HousekeepingScreen />` (**new guard**) |
| `rates/*` | `rates:write` | existing child routes unchanged |
| `inventory/*` | `inventory:write` | existing child routes unchanged |
| `settings/*` | `settings:configure` | existing child routes unchanged |

**Deletions (locked):** seven `*Route.tsx` + seven `*Route.test.tsx` under `apps/web-pms/src/screens/`.

**Tests (locked):** `apps/web-pms/src/auth/PermissionRoute.test.tsx` — parameterized matrix for **all 8 permissions** × (deny-redirect / allow-render / unknown-fail-open).

### D3 — Lock 5 (G5): ui-kit ratchet + CSS cleanup (spec §2 Lock 5)

**Locked ratchet extension** — `scripts/ui-kit-adoption-check.mjs`:

```js
const PANEL_RE = /className="panel"/g;
const BADGE_RE = /className="badge"/g;
```

Baseline `scripts/.ui-kit-adoption-baseline.json`: add `"panelClassName": 13`, `"badgeClassName": 2`; ratchet same semantics as `total`; final **`0` / `0`**.

**Replacements:** 13 `className="panel"` → `<Card>`; 2 `className="badge"` in `TapeChartScreen.tsx:280,:343` → `<Badge rung={…}>`.

**Card extension (minimal ui-kit):** forward `TestIdProps & React.ComponentPropsWithoutRef<'div'>` on root div — preserve `role`, `aria-modal`, `data-testid` on dialog panels (`SettingsScreen`, `RatesScreen`).

**CSS:** delete `.panel` (`styles.css:199–204`), `.badge` + `.badge.status-exception` (`:378–391`); merge duplicate `.side-panels` (`:165–169` shared grouping + `:421–427` grid props).

### D4 — Lock 2 (G2): `commandEnvelope` builder (spec §2 Lock 2)

**Locked file:** `apps/pms-core/src/command-envelope.ts` — signature per spec Lock 2a.

**Usage:**

```ts
const invoked = await invokePropertyDo({
  ...commandEnvelope(ctx, resolvedCtx, {
    commandId: 'inventory.add_room_type',
    routeId: 'post_room_types',
    idempotencyKey: body.idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload,
  }),
  invoke: () => resolvedCtx.resolved.stub.tryAddRoomType(…),
});
```

**Consolidate all `const invoked = await invokePropertyDo` sites** — tree has **72** (audit documented **61** minimum; do not leave stragglers).

**`propertyId` in envelope:** use `resolvedCtx.property.propertyId` — not a separate decoded param unless validated equal.

**Batching (locked — one commit each):**

| Batch | Domain | Handler / `commandId` scope |
|---|---|---|
| **G2-1** | Inventory + rooms | `inventory.*`, `rooms.*` — 9 sites |
| **G2-2** | Reservations + assign | `reservations.*`, shared status helper ~3078, `housekeeping.assign` — 11 sites |
| **G2-3** | Folio + shift + cash | charge/tax/routing/shift/payment/fx — 15 sites |
| **G2-4** | Folio windows + void/refund | windows, void, refund, capture*, authorize, reconcile, post_discount — 13 sites |
| **G2-5** | Rates + restrictions + promo | `rates.*`, `restrictions.*` — 10 sites |
| **G2-6** | Guests + roster | **Org DO path — 0 `invokePropertyDo` sites** (verify-only commit) |
| **G2-7** | City ledger + invoice | `city_ledger.*`, `invoice.*` — 6 sites |
| **G2-8** | Night audit + provisional + config | `night_audit.*`, `provisional.*`, `config.put_domain` — 8 sites |

**Forbidden in G2 commits:** error-tail refactors (G3); business logic changes.

### D5 — Lock 3 (G3): `commandErrorResponse` + mapper merge (spec §2 Lock 3)

**Locked helper:**

```ts
function commandErrorResponse(err: CommandError, permission: Permission): Response {
  if (err === NOT_MEMBER) return json({ error: 'not_found' }, 404);
  if (err === FORBIDDEN || err === SCOPE_MISMATCH) {
    return json({ error: 'forbidden', permission }, 403);
  }
  return json({ ok: false, error: err }, mapCommandErrorStatus(err));
}
```

- **Delete** `rosterWriteErrorResponse` — 5 call sites → `commandErrorResponse`.
- Replace inline 3-line ladders where body is `{ ok: false, error }` + single mapper.
- **Entity-specific NOT_FOUND prefixes stay local** — `commandErrorResponse` for tail only.
- Merge `mapGuestConcreteCommandErrorStatus` + `mapRosterConcreteCommandErrorStatus` → `mapPersonEntityCommandErrorStatus`.
- Thin wrappers `mapGuestCommandErrorStatus` / `mapRosterCommandErrorStatus`; unified `mapCommandErrorStatus`.
- **Phase D HTTP statuses unchanged** — integration tests are regression guard.
- **`rosterGetJson` paths** returning `{ error: 'not_found' }` without `ok` keep local helpers.

### D6 — CI discipline (normative — all tasks)

**Locked:** `pnpm --filter @hospai/pms-core exec vitest run --shard=N/8` — **no `--` before `--shard`**. Workerd 503 → retry that shard once. Never `|| true`. Prefer `pnpm test:local`. Per-file web-pms: `pnpm --filter @hospai/web-pms test`. **No DDL** this phase.

### D7 — Reviewer workflow

**Locked:** Spec/plan writers do **not** commit. Implementers commit per task. Living plan checkboxes: tick **Task 13 only** at implementation time. No push.

---

## Global constraints

- **Head counts unchanged** — G4 shape change only (`RouteId` export + `id` on dispatch routes).
- **TDD:** G1 PermissionRoute red-first; G5 ratchet baseline before migrations; G4 manual reorder-verify documented.
- **G2/G3:** mechanical refactors — existing green suites + `pnpm typecheck` are acceptance.
- **Sequential `v1-dispatch.ts` discipline:** G4 ids → G2 batches → G3 — never interleave G3 with partial G2.

### Scope out (forbidden across all tasks)

- DO / schema / catalog / HTTP route **count** changes
- Phase **H** audit items
- Route-guard fail-open fix on `authority.kind === 'unknown'`
- Server error codes / HTTP status changes (Phase D locked)
- Behaviour changes beyond mechanical consolidation
- Degraded-replay permission bypass, edge rate limiting, code splitting, KV registry projection
- Push

---

## File map

| File | Role | Task |
|---|---|---|
| `packages/contracts/src/v1-http-routes.ts` | G4 — export `RouteId` | 1 |
| `apps/pms-core/src/v1-dispatch.ts` | G4 `id` on routes; G2 envelope; G3 error helper + mappers | 1, 4–12 |
| `apps/pms-core/src/invoke-property-do.ts` | G4 — `routeId: RouteId` | 1 |
| `scripts/permissions-check.mjs` | G4 — id-keyed drift | 1 |
| `apps/web-pms/src/auth/PermissionRoute.tsx` | **New** — G1 shared guard | 2 |
| `apps/web-pms/src/auth/PermissionRoute.test.tsx` | **New** — G1 parameterized tests | 2 |
| `apps/web-pms/src/App.tsx` | G1 — nested routes | 2 |
| `apps/web-pms/src/screens/*Route.tsx` (×7) | G1 — **delete** | 2 |
| `apps/web-pms/src/screens/*Route.test.tsx` (×7) | G1 — **delete** | 2 |
| `apps/web-pms/src/screens/HousekeepingScreen.tsx` | G1 — affordances only post-guard | 2 |
| `apps/pms-core/src/command-envelope.ts` | **New** — G2 builder | 4 |
| `scripts/ui-kit-adoption-check.mjs` | G5 — panel/badge literal counts | 3 |
| `scripts/.ui-kit-adoption-baseline.json` | G5 — baseline 13/2 → 0/0 | 3 |
| `packages/ui-kit/src/Card.tsx` | G5 — forward div props | 3 |
| `apps/web-pms/src/screens/*.tsx` (12 files) | G5 — `panel` → `<Card>` | 3 |
| `apps/web-pms/src/screens/TapeChartScreen.tsx` | G5 — `badge` → `<Badge>` | 3 |
| `apps/web-pms/src/styles.css` | G5 — delete `.panel`/`.badge`; merge `.side-panels` | 3 |
| `docs/superpowers/specs/2026-08-16-audit-phase-g-structural-design.md` | Tick §8 checklist | 13 |
| `docs/superpowers/plans/2026-08-16-audit-phase-g-structural.md` | Task 13 checkboxes (this file) | 13 |

**Not touched:** `COMMAND_CATALOG`, `PROPERTY_SCHEMA_HEAD`, `NIGHT_AUDIT_STEPS`, idempotency const count, `V1_HTTP_ROUTE_AUDIT` entry list (144 ids unchanged).

---

## Spec §1.7 / §4 / §8 → task map

| Spec item | Task |
|---|---|
| Lock 4 (G4) — `RouteId`, id-keyed drift, typed `routeId` | 1 |
| Lock 1 (G1) — `PermissionRoute`, nested routes, housekeeping guard | 2 |
| Lock 5 (G5) — ratchet, Card/Badge migration, CSS | 3 |
| Lock 2 (G2) — `commandEnvelope`, 8 domain batches | 4–11 |
| Lock 3 (G3) — `commandErrorResponse`, mapper merge | 12 |
| §5 test plan / §5.6 full suite | 1–13 |
| §1.9 scope out | forbidden all |
| §8 checklist | 13 |

---

### Task 1: G4 — `RouteId` export + id-keyed permissions drift

**Spec:** Lock 4, §5.4.

**Files:**
- Modify: `packages/contracts/src/v1-http-routes.ts`
- Modify: `apps/pms-core/src/v1-dispatch.ts` (`V1RouteDef`, all `V1_ROUTES` entries ~7784+)
- Modify: `apps/pms-core/src/invoke-property-do.ts`
- Modify: `scripts/permissions-check.mjs`

**Interfaces:**
- Produces: `export type RouteId = …`; every route has `id: RouteId`; id-map drift check
- Frozen heads: **144 route count unchanged**; **shape change sanctioned**

**Forbidden this commit:** G2 envelope adoption; G1/G5 web-pms; reorder `V1_ROUTES` for production (manual verify only).

- [ ] **Step 1: Export `RouteId` from contracts**

Add to `packages/contracts/src/v1-http-routes.ts` (after `V1_HTTP_ROUTE_AUDIT` definition):

```ts
export type RouteId = (typeof V1_HTTP_ROUTE_AUDIT)[number]['id'];
```

Build contracts:

```bash
pnpm --filter @hospai/contracts build
```

- [ ] **Step 2: Add `id: RouteId` to `V1RouteDef` and all 144 `V1_ROUTES` entries**

1. Import `RouteId` from `@hospai/contracts` in `v1-dispatch.ts`.
2. Extend route base type with `id: RouteId`.
3. For each entry, set `id` matching `V1_HTTP_ROUTE_AUDIT` (grep audit tail: `[143].id === 'get_city_ledger_statement'`).
4. **Do not** change route count, patterns, handlers, or permissions.

- [ ] **Step 3: Id-keyed `permissions-check.mjs` + type `invokePropertyDo.routeId`**

1. Parse `id` from route blocks; build `Map` keyed by id.
2. Lookup audit entries by `audit.id`; same field compare as today.
3. Fail on missing/extra ids with spec messages.
4. Change `invoke-property-do.ts` `routeId: string` → `routeId: RouteId`.

Verify:

```bash
pnpm --filter @hospai/contracts build
pnpm check:permissions
pnpm typecheck
```

Expected: **PASS** — 144 routes; no drift.

- [ ] **Step 4: Manual reorder verification (document in commit message / PR — not CI)**

1. **Locally only:** swap two adjacent `V1_ROUTES` entries with identical metadata.
2. Run `pnpm check:permissions` → **expect green** (order-independent).
3. Change one entry's `permission` without updating audit → **expect** `Drift detected for route id '…': field 'permission' mismatch`.
4. **Revert** swap/mutation before commit.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/v1-http-routes.ts \
  apps/pms-core/src/v1-dispatch.ts \
  apps/pms-core/src/invoke-property-do.ts \
  scripts/permissions-check.mjs
git commit -m "$(cat <<'EOF'
refactor(contracts,pms-core): add RouteId and id-keyed route drift check

Export RouteId from contracts, add id to every V1_ROUTES entry, and key
check:permissions on route id instead of fragile array index order.
EOF
)"
```

---

### Task 2: G1 — `PermissionRoute` + nested routes + housekeeping guard

**Spec:** Lock 1, §5.1.

**Files:**
- Create: `apps/web-pms/src/auth/PermissionRoute.tsx`
- Create: `apps/web-pms/src/auth/PermissionRoute.test.tsx`
- Modify: `apps/web-pms/src/App.tsx`
- Modify: `apps/web-pms/src/screens/HousekeepingScreen.tsx`
- Delete: `apps/web-pms/src/screens/RatesRoute.tsx`, `InventoryRoute.tsx`, `SettingsRoute.tsx`, `BookRoute.tsx`, `NightAuditRoute.tsx`, `RosterRoute.tsx`, `StaffRoute.tsx`
- Delete: seven matching `*Route.test.tsx` files

**Interfaces:**
- Produces: single guard component; all 8 permissions nested in `App.tsx`
- Frozen heads: unchanged

**Forbidden this commit:** G5 panel migrations; fail-open fix; pms-core changes.

- [ ] **Step 1: Write failing parameterized PermissionRoute tests (red)**

Create `PermissionRoute.test.tsx` covering **8 permissions**:

| Permission | Screen testid | Route path |
|---|---|---|
| `rates:write` | `rates-screen` | `/rates` |
| `inventory:write` | `inventory-screen` | `/inventory` |
| `settings:configure` | `settings-screen` | `/settings/property` |
| `reservations:write` | `booking-screen` | `/book` |
| `night_audit:run` | `night-audit-screen` | `/night-audit` |
| `roster:write` | `roster-screen` | `/roster` |
| `staff:read` | `staff-screen` | `/staff` |
| `housekeeping:read` | `housekeeping-board` | `/housekeeping` |

For each permission, three cases:

1. **Live deny** — me without permission → redirect `/arrivals`; nested testid absent.
2. **Live allow** — me with permission → nested screen mounts.
3. **Unknown fail-open** — `authority.kind === 'unknown'` → nested screen **does** mount.

Mirror fixture patterns from `RatesRoute.test.tsx` / `BookRoute.test.tsx` (`getMe` mock, `MemoryRouter`, minimal nested route).

Run red (file/component does not exist yet):

```bash
pnpm --filter @hospai/web-pms exec vitest run src/auth/PermissionRoute.test.tsx
```

Expected: **FAIL** — module not found.

- [ ] **Step 2: Implement `PermissionRoute.tsx`**

Extract shared logic from `RatesRoute.tsx` (~14–45): `useQuery(['me', propertyId])`, `meShellStateFromQuery`, pending/null → `null`, live deny → `<Navigate to={fallback} replace />`, live allow + unknown → `<Outlet />`.

Add brief comment citing audit Do-not-fix: unknown authority fail-open is deliberate.

- [ ] **Step 3: Convert `App.tsx` to nested routes + housekeeping guard**

Pattern:

```tsx
<Route path="book" element={<PermissionRoute permission="reservations:write" />}>
  <Route index element={<BookingScreen />} />
</Route>
```

Apply to book, night-audit, staff, roster, rates/*, inventory/*, settings/*, housekeeping/*.

Remove seven `*Route` imports; import `PermissionRoute` from `./auth/PermissionRoute.js`.

- [ ] **Step 4: Trim `HousekeepingScreen.tsx` gating flicker**

Keep `canAssign` / `canReadRoster` / `canSetOoo` from settled `me` for affordances — guard now blocks deep-link without `housekeeping:read`. Do **not** use unsettled `me` for route-level gating.

- [ ] **Step 5: Delete old route files + verify green**

```bash
pnpm --filter @hospai/web-pms exec vitest run src/auth/PermissionRoute.test.tsx
pnpm --filter @hospai/web-pms test
pnpm check:web-pms-me-gating
```

Expected: **PASS** — 8 × 3 matrix green; no stale `*Route` imports.

- [ ] **Step 6: Commit**

```bash
git add apps/web-pms/src/auth/PermissionRoute.tsx \
  apps/web-pms/src/auth/PermissionRoute.test.tsx \
  apps/web-pms/src/App.tsx \
  apps/web-pms/src/screens/HousekeepingScreen.tsx
git add -u apps/web-pms/src/screens/*Route*.tsx
git commit -m "$(cat <<'EOF'
refactor(web-pms): consolidate route guards into PermissionRoute

Replace seven duplicate *Route guards with one PermissionRoute using nested
routes, add housekeeping:read guard, and preserve unknown-authority fail-open.
EOF
)"
```

---

### Task 3: G5 — ui-kit ratchet + panel/badge migration + CSS cleanup

**Spec:** Lock 5, §5.5.

**Files:**
- Modify: `scripts/ui-kit-adoption-check.mjs`
- Modify: `scripts/.ui-kit-adoption-baseline.json`
- Modify: `packages/ui-kit/src/Card.tsx`
- Modify: 12 screen files with `className="panel"` (see grep list)
- Modify: `apps/web-pms/src/screens/TapeChartScreen.tsx` (2 badges)
- Modify: `apps/web-pms/src/styles.css`

**Interfaces:**
- Produces: ratchet counts `panelClassName`/`badgeClassName`; baseline **0/0**; merged `.side-panels`
- Frozen heads: unchanged

**Forbidden this commit:** App.tsx route changes; pms-core changes.

- [ ] **Step 1: Extend ratchet + set baseline 13/2 (red on migration attempt without baseline)**

Update `ui-kit-adoption-check.mjs`:

```js
const PANEL_RE = /className="panel"/g;
const BADGE_RE = /className="badge"/g;
```

Count in same `SCAN_ROOTS`; ratchet `panelClassName` / `badgeClassName` with same rise/fall rules as `total`.

Update baseline:

```json
{
  "total": 0,
  "byTag": { … },
  "panelClassName": 13,
  "badgeClassName": 2,
  …
}
```

Verify baseline gate passes **before** replacements:

```bash
pnpm check:ui-kit-adoption
```

Expected: **PASS** at 13/2.

- [ ] **Step 2: Extend `Card` div prop forwarding**

```tsx
export type CardProps = TestIdProps &
  React.ComponentPropsWithoutRef<'div'> & {
    children?: ReactNode;
  };

export function Card({ children, className, ...rest }: CardProps) {
  return (
    <div className={clsx('ui-card', className)} {...rest}>
      {children}
    </div>
  );
}
```

Preserve `data-testid`, `role="dialog"`, `aria-modal` on dialog panels.

- [ ] **Step 3: Migrate 13 `panel` → `<Card>` + 2 `badge` → `<Badge rung>`**

Panel sites (13): `RatesScreen` (×2), `ExceptionsScreen`, `BoardScreen`, `CheckInScreen`, `FolioScreen`, `StaffScreen`, `BookingScreen`, `TapeChartScreen`, `InventoryScreen`, `CityLedgerScreen` (×3), `NightAuditScreen`, `RosterScreen`, `SettingsScreen` (×3).

Badge sites: `TapeChartScreen.tsx:280,:343` — map room `status` to `StatusRung` via existing helpers where possible; default `rung="neutral"`.

Import `Card` / `Badge` from `@hospai/ui-kit`.

- [ ] **Step 4: CSS cleanup + baseline 0/0**

1. Delete `.panel` block (`styles.css:199–204`).
2. Delete `.badge` + `.badge.status-exception` (`:378–391`).
3. Merge `.side-panels`: keep `.top-bar, .shift-strip, .side-panels` shared props; add grid props from second block; single `.side-panels` rule set.

Update baseline → `"panelClassName": 0, "badgeClassName": 0`.

Verify:

```bash
pnpm check:ui-kit-adoption
pnpm check:web-pms-colors
pnpm --filter @hospai/web-pms test
```

Expected: **PASS**; visual spot-check tape chart badges + dialog panels.

- [ ] **Step 5: Commit**

```bash
git add scripts/ui-kit-adoption-check.mjs \
  scripts/.ui-kit-adoption-baseline.json \
  packages/ui-kit/src/Card.tsx \
  apps/web-pms/src/screens/*.tsx \
  apps/web-pms/src/styles.css
git commit -m "$(cat <<'EOF'
refactor(web-pms): migrate panel/badge literals to ui-kit

Extend ui-kit adoption ratchet for className panel/badge literals, replace
13 panels with Card and 2 badges with Badge, and remove duplicate CSS.
EOF
)"
```

---

### Task 4: G2-1 — `commandEnvelope` inventory + rooms batch

**Spec:** Lock 2, §2b batch 1, §5.2.

**Files:**
- Create: `apps/pms-core/src/command-envelope.ts`
- Modify: `apps/pms-core/src/v1-dispatch.ts` (9 handlers)

**Handlers (9 sites):** `inventory.add_room_type`, `inventory.update_room_type`, `inventory.delete_room_type`, `rooms.delete`, `rooms.create`, `rooms.update`, `rooms.update_status`, `rooms.set_ooo_range`, `rooms.bulk_update_status`.

**Forbidden:** G3 error-tail edits; non-inventory/rooms handlers.

- [ ] **Step 1: Create `command-envelope.ts` per spec Lock 2a**

- [ ] **Step 2: Replace preamble blocks in 9 handlers only**

Pattern: spread `commandEnvelope(ctx, resolvedCtx, { commandId, routeId, idempotencyKey, requestFingerprint, commandPayload })` + `invoke`.

- [ ] **Step 3: Verify**

```bash
pnpm typecheck
pnpm --filter @hospai/pms-core exec vitest run \
  apps/pms-core/test/inventory.spec.ts \
  apps/pms-core/test/rooms-routes.spec.ts \
  apps/pms-core/test/rooms-ooo-routes.spec.ts
```

Expected: **PASS**.

- [ ] **Step 4: Commit**

```bash
git add apps/pms-core/src/command-envelope.ts apps/pms-core/src/v1-dispatch.ts
git commit -m "$(cat <<'EOF'
refactor(pms-core): adopt commandEnvelope for inventory and rooms

Extract invokePropertyDo preamble into commandEnvelope builder for nine
inventory.* and rooms.* dispatch handlers.
EOF
)"
```

---

### Task 5: G2-2 — `commandEnvelope` reservations + assign batch

**Spec:** Lock 2, §2b batch 2.

**Files:**
- Modify: `apps/pms-core/src/v1-dispatch.ts` (11 handlers)

**Handlers (11 sites):** `reservations.create`, `modify`, `cancel`, `confirm`, `hold`, `update_status`, shared helper ~3078, `check_in`, `check_out`, `assign_room`, `housekeeping.assign`.

**Forbidden:** other domains; G3 edits.

- [ ] **Step 1: Replace preamble blocks in 11 handlers**

- [ ] **Step 2: Verify**

```bash
pnpm typecheck
pnpm --filter @hospai/pms-core exec vitest run \
  apps/pms-core/test/reservations.spec.ts \
  apps/pms-core/test/reservations-routes.spec.ts \
  apps/pms-core/test/reservations-check-in.spec.ts \
  apps/pms-core/test/reservations-check-out.spec.ts \
  apps/pms-core/test/roster-assign.spec.ts
```

Expected: **PASS**.

- [ ] **Step 3: Commit**

```bash
git add apps/pms-core/src/v1-dispatch.ts
git commit -m "$(cat <<'EOF'
refactor(pms-core): adopt commandEnvelope for reservations and assign

Consolidate invokePropertyDo preambles for reservation lifecycle handlers
and housekeeping.assign using commandEnvelope.
EOF
)"
```

---

### Task 6: G2-3 — `commandEnvelope` folio + shift + cash batch

**Spec:** Lock 2, §2b batch 3.

**Files:**
- Modify: `apps/pms-core/src/v1-dispatch.ts` (15 handlers)

**Handlers (15 sites):** `folio.add_item`, charge codes, routing rules, tax rules, `folio.open_shift`, `folio.close_shift`, `folio.record_cash_payment`, `folio.create_fx_rate`, `folio.supersede_fx_rate`, `folio.record_chargeback`, `folio.post_fx_adjustment`.

**Forbidden:** folio window/void/refund handlers (G2-4); G3 edits.

- [ ] **Step 1: Replace preamble blocks in 15 handlers**

- [ ] **Step 2: Verify**

```bash
pnpm typecheck
pnpm --filter @hospai/pms-core exec vitest run \
  apps/pms-core/test/folio-routes.spec.ts \
  apps/pms-core/test/charge-codes.spec.ts \
  apps/pms-core/test/cashiering.spec.ts \
  apps/pms-core/test/folio-fx-routes.spec.ts
```

Expected: **PASS**.

- [ ] **Step 3: Commit**

```bash
git add apps/pms-core/src/v1-dispatch.ts
git commit -m "$(cat <<'EOF'
refactor(pms-core): adopt commandEnvelope for folio shift and cash

Consolidate invokePropertyDo preambles for folio charges, tax, routing,
shift, cash payment, and FX handlers.
EOF
)"
```

---

### Task 7: G2-4 — `commandEnvelope` folio windows + void/refund batch

**Spec:** Lock 2, §2b batch 4.

**Files:**
- Modify: `apps/pms-core/src/v1-dispatch.ts` (13 handlers)

**Handlers (13 sites):** `folio.split_charge`, window open/close/reopen, `folio.transfer_charge`, `folio.void`, `folio.reconcile_payment`, `folio.refund`, `folio.post_discount` (×2), `folio.capture_due`, `folio.authorize`, `folio.capture`.

**Forbidden:** G3 error-tail refactors in same commit.

- [ ] **Step 1: Replace preamble blocks in 13 handlers**

- [ ] **Step 2: Verify**

```bash
pnpm typecheck
pnpm --filter @hospai/pms-core exec vitest run \
  apps/pms-core/test/folio-windows.spec.ts \
  apps/pms-core/test/folio-payments.spec.ts \
  apps/pms-core/test/folio-payment-lifecycle.spec.ts
```

Expected: **PASS**.

- [ ] **Step 3: Commit**

```bash
git add apps/pms-core/src/v1-dispatch.ts
git commit -m "$(cat <<'EOF'
refactor(pms-core): adopt commandEnvelope for folio windows and payments

Consolidate invokePropertyDo preambles for folio window, void, refund,
capture, and discount handlers.
EOF
)"
```

---

### Task 8: G2-5 — `commandEnvelope` rates + restrictions + promo batch

**Spec:** Lock 2, §2b batch 5.

**Files:**
- Modify: `apps/pms-core/src/v1-dispatch.ts` (10 handlers)

**Handlers (10 sites):** `rates.upsert_day`, `restrictions.upsert_day`, rate plan CRUD, promo CRUD, `rates.update_room_type_rate`, `rates.bulk_update`.

**Forbidden:** other domains; G3 edits.

- [ ] **Step 1: Replace preamble blocks in 10 handlers**

- [ ] **Step 2: Verify**

```bash
pnpm typecheck
pnpm --filter @hospai/pms-core exec vitest run \
  apps/pms-core/test/rate-plans-routes.spec.ts \
  apps/pms-core/test/restrictions-rates.spec.ts \
  apps/pms-core/test/promo-codes.spec.ts
```

Expected: **PASS**.

- [ ] **Step 3: Commit**

```bash
git add apps/pms-core/src/v1-dispatch.ts
git commit -m "$(cat <<'EOF'
refactor(pms-core): adopt commandEnvelope for rates and restrictions

Consolidate invokePropertyDo preambles for rate plans, day upserts,
restrictions, and promo handlers.
EOF
)"
```

---

### Task 9: G2-6 — `commandEnvelope` guests + roster batch (verify-only)

**Spec:** Lock 2, §2b batch 6.

**Files:**
- Modify: none expected (`guests.*` and `roster.*` use **Org DO** transport — **0** `invokePropertyDo` sites in tree)

**Forbidden:** inventing invokePropertyDo for org-path handlers; G3 edits.

- [ ] **Step 1: Confirm zero `invokePropertyDo` sites for `guests.*` / `roster.*`**

```bash
rg "invokePropertyDo" apps/pms-core/src/v1-dispatch.ts | rg -v "import|from" | wc -l
rg "commandId: '(guests|roster)\." apps/pms-core/src/v1-dispatch.ts
```

Expected: guest/roster write paths call `org.try*` — no envelope change needed.

- [ ] **Step 2: Verify domain specs green**

```bash
pnpm typecheck
pnpm --filter @hospai/pms-core exec vitest run \
  apps/pms-core/test/guests-routes.spec.ts \
  apps/pms-core/test/roster-routes.spec.ts \
  apps/pms-core/test/roster.spec.ts
```

Expected: **PASS**.

- [ ] **Step 3: Commit (document verify-only batch)**

```bash
git commit --allow-empty -m "$(cat <<'EOF'
chore(pms-core): G2-6 guests/roster batch — no invokePropertyDo sites

Guests and roster write handlers use Org DO transport; envelope adoption
does not apply. Domain specs verified green before continuing G2 batches.
EOF
)"
```

---

### Task 10: G2-7 — `commandEnvelope` city ledger + invoice batch

**Spec:** Lock 2, §2b batch 7.

**Files:**
- Modify: `apps/pms-core/src/v1-dispatch.ts` (6 handlers)

**Handlers (6 sites):** `invoice.generate`, `invoice.void`, `city_ledger.create_account`, `archive_account`, `update_account`, `receive_payment`.

**Forbidden:** G3 edits; other domains.

- [ ] **Step 1: Replace preamble blocks in 6 handlers**

- [ ] **Step 2: Verify**

```bash
pnpm typecheck
pnpm --filter @hospai/pms-core exec vitest run \
  apps/pms-core/test/city-ledger.spec.ts \
  apps/pms-core/test/invoice-generation.spec.ts
```

Expected: **PASS**.

- [ ] **Step 3: Commit**

```bash
git add apps/pms-core/src/v1-dispatch.ts
git commit -m "$(cat <<'EOF'
refactor(pms-core): adopt commandEnvelope for city ledger and invoice

Consolidate invokePropertyDo preambles for invoice and city ledger handlers.
EOF
)"
```

---

### Task 11: G2-8 — `commandEnvelope` night audit + provisional + config batch

**Spec:** Lock 2, §2b batch 8.

**Files:**
- Modify: `apps/pms-core/src/v1-dispatch.ts` (8 handlers)

**Handlers (8 sites):** `config.put_domain`, `night_audit.run`, `retry_step`, `resolve_halt`, `provisional.resolve_exception`, `retry_exception`, `assign_exception`, `add_exception_note`.

**Forbidden:** G3 error helper in same commit.

- [ ] **Step 1: Replace preamble blocks in 8 handlers**

- [ ] **Step 2: Confirm all 72 sites use envelope**

```bash
rg "env: ctx\.env,\s*$" apps/pms-core/src/v1-dispatch.ts | wc -l
rg "commandEnvelope\(" apps/pms-core/src/v1-dispatch.ts | wc -l
```

Expected: **0** hand-assembled six-line preambles remaining; **72** envelope spreads (or equivalent count).

- [ ] **Step 3: Verify**

```bash
pnpm typecheck
pnpm --filter @hospai/pms-core exec vitest run \
  apps/pms-core/test/night-audit-routes.spec.ts \
  apps/pms-core/test/domain-config-routes.spec.ts \
  apps/pms-core/test/exception-workbench.spec.ts \
  apps/pms-core/test/property-details-routes.spec.ts
```

Expected: **PASS**.

- [ ] **Step 4: Commit**

```bash
git add apps/pms-core/src/v1-dispatch.ts
git commit -m "$(cat <<'EOF'
refactor(pms-core): adopt commandEnvelope for audit and provisional

Consolidate invokePropertyDo preambles for domain config, night audit, and
provisional exception handlers — completing all property-DO envelope sites.
EOF
)"
```

---

### Task 12: G3 — `commandErrorResponse` + mapper merge

**Spec:** Lock 3, §5.3.

**Files:**
- Modify: `apps/pms-core/src/v1-dispatch.ts` (or optional extract `command-error-response.ts`)

**Interfaces:**
- Produces: `commandErrorResponse(err, permission)`; `mapPersonEntityCommandErrorStatus`; `mapCommandErrorStatus`
- Frozen heads: unchanged; **HTTP statuses unchanged**

**Forbidden:** entity-NOT_FOUND prefix absorption; status changes; new routes.

- [ ] **Step 1: Merge concrete mappers → `mapPersonEntityCommandErrorStatus`**

Union guest + roster 404/409 cases per spec Lock 3b; shared tail identical; thin wrappers remain.

Add:

```ts
function mapCommandErrorStatus(error: CommandError): number {
  return mapGuestCommandErrorStatus(error);
}
```

- [ ] **Step 2: Add `commandErrorResponse`; delete `rosterWriteErrorResponse`**

Replace 5 `rosterWriteErrorResponse` call sites.

Replace inline 3-line ladders (≥15 handlers) where tail matches spec — **keep local NOT_FOUND prefixes** (e.g. `RATE_PLAN_NOT_FOUND`) before helper.

- [ ] **Step 3: Verify statuses unchanged**

```bash
pnpm typecheck
pnpm --filter @hospai/pms-core exec vitest run \
  apps/pms-core/test/guests-routes.spec.ts \
  apps/pms-core/test/roster-routes.spec.ts \
  apps/pms-core/test/roster.spec.ts \
  apps/pms-core/test/reservations-routes.spec.ts
```

Spot-check: `not_member` → **404**; `FORBIDDEN`/`scope_mismatch` → **403**; domain errors match Phase D table.

Expected: **PASS** — no expectation changes.

- [ ] **Step 4: Commit**

```bash
git add apps/pms-core/src/v1-dispatch.ts
git commit -m "$(cat <<'EOF'
refactor(pms-core): generalize commandErrorResponse and merge mappers

Replace rosterWriteErrorResponse and duplicate error ladders with
commandErrorResponse; merge guest/roster concrete status mappers.
EOF
)"
```

---

### Task 13: Final verification + checklist

**Spec:** §1.7, §5.6, §8 checklist.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-16-audit-phase-g-structural-design.md` — tick §8
- Modify: `docs/superpowers/plans/2026-08-16-audit-phase-g-structural.md` — Task 13 checkboxes only

**Forbidden this commit:** new features; scope-out items.

- [ ] **Step 1: Targeted Phase G specs**

```bash
pnpm check:permissions
pnpm check:ui-kit-adoption
pnpm check:web-pms-colors
pnpm --filter @hospai/web-pms exec vitest run src/auth/PermissionRoute.test.tsx
pnpm --filter @hospai/web-pms test
pnpm --filter @hospai/pms-core exec vitest run \
  apps/pms-core/test/guests-routes.spec.ts \
  apps/pms-core/test/roster-routes.spec.ts \
  apps/pms-core/test/inventory.spec.ts \
  apps/pms-core/test/folio-routes.spec.ts \
  apps/pms-core/test/night-audit-routes.spec.ts
```

Expected: **PASS**.

- [ ] **Step 2: typecheck / build / lint**

```bash
pnpm typecheck
pnpm build
pnpm lint
```

Expected: all **PASS**.

- [ ] **Step 3: All 14 `check:*` gates**

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

Expected: all **PASS** (`check:ddl` confirm-only — no migration).

- [ ] **Step 4: Full local test loop — long pole**

```bash
pnpm test:local
```

Expected: non-pms-core turbo tests + all **8** pms-core shards green. Workerd 503 → retry shard once.

- [ ] **Step 5: Pin frozen heads — counts unchanged + G4 shape present**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes|PLATFORM_GAPS"
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "schema head constants"
test "$(rg -c '^export const' packages/contracts/src/idempotency.ts)" -eq 158
rg "export type RouteId" packages/contracts/src/v1-http-routes.ts
rg "id: '" apps/pms-core/src/v1-dispatch.ts | wc -l
```

Expect: catalog **89**; writers **63**; routes **144**, tail `get_city_ledger_statement`; schema **34**; steps **8** `[3] AUTO_TRANSFER`; idempotency consts **158**; `RouteId` exported; **144** route ids in dispatch.

- [ ] **Step 6: Scope-out grep — must be clean**

```bash
! rg "authority\.kind === 'unknown'" apps/web-pms/src/auth/PermissionRoute.tsx | rg -v "Outlet|fail.open|DO NOT"
! rg "className=\"panel\"" apps/web-pms/src/screens/
! rg "className=\"badge\"" apps/web-pms/src/screens/
! rg "function rosterWriteErrorResponse" apps/pms-core/src/v1-dispatch.ts
```

Expected: fail-open preserved; no panel/badge literals; `rosterWriteErrorResponse` deleted.

- [ ] **Step 7: Tick spec §8 reviewer checklist**

Tick every item in `docs/superpowers/specs/2026-08-16-audit-phase-g-structural-design.md` §8.

- [ ] **Step 8: Tick Task 13 checkboxes in this plan only**

Do **not** retroactively tick Tasks 1–12 unless already done during implementation.

- [ ] **Step 9: Commit**

```bash
git add docs/superpowers/specs/2026-08-16-audit-phase-g-structural-design.md \
  docs/superpowers/plans/2026-08-16-audit-phase-g-structural.md
git commit -m "$(cat <<'EOF'
chore(docs): finalize audit Phase G verification checklist

Confirm structural fixes G1–G5 green across full gate suite, frozen head
counts unchanged, and G4 RouteId shape change landed.
EOF
)"
```

**Stop.** Audit **G1–G5** closed. Phase **H** may proceed.

---

## Verification (plan-level summary)

| # | Command / assertion | Expectation | Task |
|---|---|---|---|
| 1 | `pnpm check:permissions` | Id-keyed drift; **144** routes | 1, 13 |
| 2 | Manual reorder swap | Order-independent green | 1 |
| 3 | `pnpm --filter @hospai/web-pms exec vitest run src/auth/PermissionRoute.test.tsx` | 8 × 3 matrix green | 2, 13 |
| 4 | `pnpm check:ui-kit-adoption` | panel/badge **0/0** | 3, 13 |
| 5 | `pnpm typecheck` | All `routeId` literals satisfy `RouteId` | 4–12, 13 |
| 6 | G2 batch domain specs | Green per batch | 4–11 |
| 7 | Guest/roster/reservation error specs | Statuses unchanged post-G3 | 12, 13 |
| 8 | `pnpm test:local` | **Long pole** — 8 shards green | 13 |
| 9 | All 14 `check:*` gates | Green | 13 |
| 10 | `pnpm build` / `pnpm lint` | Green | 13 |
| 11 | Frozen heads pin | counts unchanged; `RouteId` + 144 ids present | 13 |

---

## CI discipline (verbatim — implementers)

`pnpm --filter @hospai/pms-core exec vitest run --shard=N/8` — no `--` before `--shard`. Workerd 503 → retry once. Never `|| true`. Prefer `pnpm test:local`. No DDL this phase.

---

## Spec §8 reviewer checklist (Task 13 ticks spec file when CI is green)

| §8 item | Satisfied by |
|---|---|
| Lock 1 (G1): `PermissionRoute`; nested routes; housekeeping `housekeeping:read`; fail-open | 2 |
| Lock 2 (G2): `commandEnvelope`; 8 domain batches committed separately | 4–11 |
| Lock 3 (G3): `commandErrorResponse`; merged `mapPersonEntityCommandErrorStatus`; statuses unchanged | 12 |
| Lock 4 (G4): `id` on all `V1_ROUTES`; `RouteId` export; id-keyed check; typed `routeId` | 1 |
| Lock 5 (G5): ratchet panel/badge; 13 + 2 replacements; CSS; baseline 0/0 | 3 |
| Frozen head **counts** unchanged; G4 shape only | 13 |
| Scope-out respected | 13 |
| `pnpm test:local` green | 1–13 |
| All **14** `check:*` gates green | 13 |

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| §1.8 scope in | 1–13 |
| §1.9 scope out | forbidden all |
| §2 Locks 1–5 | 1–12 |
| §3 file map | 1–13 |
| §4 / §5 test plan | 1–13 |
| §8 checklist | 13 |
| Frozen heads §1.7 / §9 | G4 shape only |

**Gaps:** None — spec scope fully mapped.

**Tree conflicts:** Spec §9 — G4 `V1_ROUTES` shape + `RouteId` export sanctioned; counts fixed at 89/63/144/34/8/158.

---

## Approximate line numbers — read actual code first

Spec citations are tree-verified 2026-08-16 but **will drift**. Implementers **must grep / read** before editing:

| Area | Spec cites | Plan note |
|---|---|---|
| `V1_ROUTES` | `v1-dispatch.ts:7784+` | Task 1 — add `id: RouteId` to all 144 entries |
| `V1RouteDef` | `v1-dispatch.ts:1291+` | Task 1 — extend base type |
| `permissions-check` index loop | `permissions-check.mjs:79–88` | Task 1 — replace with id map |
| `invokePropertyDo` signature | `invoke-property-do.ts:17` | Task 1 — `routeId: RouteId` |
| `RatesRoute` guard pattern | `RatesRoute.tsx:14–45` | Task 2 — extract to PermissionRoute |
| `App.tsx` routes | `App.tsx:50–73` | Task 2 — nested PermissionRoute |
| `HousekeepingScreen` affordances | `HousekeepingScreen.tsx:22–25` | Task 2 — post-guard only |
| `rosterWriteErrorResponse` | `v1-dispatch.ts:2224–2230` | Task 12 — delete |
| Guest/roster mappers | `v1-dispatch.ts:563+,753+` | Task 12 — merge |
| `invokePropertyDo` preambles | ~1659+ (72 sites) | Tasks 4–11 |
| `.panel` CSS | `styles.css:199–204` | Task 3 — delete |
| `.badge` CSS | `styles.css:378–391` | Task 3 — delete |
| `.side-panels` duplicate | `styles.css:165–169,421–427` | Task 3 — merge |
| TapeChart badges | `TapeChartScreen.tsx:280,343` | Task 3 — `<Badge rung>` |
| `Card` component | `packages/ui-kit/src/Card.tsx` | Task 3 — forward div props |
| ui-kit ratchet | `ui-kit-adoption-check.mjs:17–28` | Task 3 — add PANEL/BADGE_RE |

---

## Plan writer interpretations (flagged for reviewer)

1. **Sequential G4→G1:** spec §3 allows G4 ∥ G1; reviewer lock overrides to **sequential G4 first** to avoid Phase E working-tree collisions — plan follows reviewer lock.
2. **G2-6 empty batch:** `guests.*` and `roster.*` handlers use Org DO (`org.tryCreateGuest`, `org.tryAddRoster`, etc.) — **zero** `invokePropertyDo` sites. Task 9 is verify-only with `--allow-empty` commit per spec batch discipline; do **not** reroute guests/roster through property DO.
3. **G2 site counts (72 total):** tree grep `const invoked = await invokePropertyDo` = **72**; batch table in D4 reflects current tree — audit **61** is documented minimum, not a cap.
4. **Shared reservation status helper (~3078):** uses dynamic `commandId`/`routeId` locals — envelope opts pass those variables; still counts as G2-2 site.
5. **`property.update_details`:** Org DO path — **not** in G2 batches; only `config.put_domain` from property DO in G2-8.
6. **TapeChart `Badge` rung mapping:** implementer maps room `status` string via existing severity helpers; default `neutral` — flag if new mapping table needed (spec §6 open decision).
7. **`command-error-response.ts` extract:** spec allows extract if noise reduction — plan defaults to in-file unless file exceeds reviewer comfort; behaviour identical either way.
8. **G4 id assignment tooling:** implementer may script ids from `V1_HTTP_ROUTE_AUDIT` export — manual typo guard is `RouteId` compile + `check:permissions`.
9. **Housekeeping testid:** use stable testid from `@hospai/pms-housekeeping/ui` board or mock nested element with `data-testid="housekeeping-board"` consistent with existing screen tests.
10. **Task 9 `--allow-empty`:** preserves one-commit-per-batch invariant when batch has zero envelope sites; alternative is skip commit — reviewer preferred empty commit for batch traceability.

---

## Risks

| Risk | Mitigation |
|---|---|
| G1 fail-open regression | Explicit unknown-authority case in parameterized tests; Do-not-fix comment |
| G4 id typo in 144 entries | `RouteId` compile-time + `check:permissions` id map |
| G2/G3 merge conflicts in `v1-dispatch.ts` | Locked sequential batches; G3 only after G2-8 |
| G5 Card dialog a11y regression | Forward `role`/`aria-modal`/`data-testid`; visual spot-check |
| G5 Badge colour drift on tape chart | `StatusRung` + `statusRungClass` token rungs |
| G3 accidental status change | Phase D mapper table normative; guest/roster specs unchanged |
| Index-check removal hides count mismatch | Keep length equality + id set equality in permissions check |
| Phase E-style staging collision | Sequential G4→G1→G5 before any pms-core G2 work |
| G2-6 empty commit noise | Documents verify-only batch; avoids skipping batch traceability |
