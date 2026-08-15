# Update extras retirement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Draft (plan writer, 2026-08-15)
>
> **Spec/plan writers do not commit.** Implementers commit per task. Work on `main`. No push.

**Goal:** Physically remove catalog-only `reservations.update_extras` and its prototype carrier `UPDATE_RESERVATION_EXTRAS`. No DO/HTTP/client/SPA changes — the id was never dispatchable. Desk extras remain `ADD_FOLIO_ITEM` / `folio.add_item`. Catalog **90 → 89**; prototype actions **35 → 34**; audit writers **63** unchanged; route audit **144** unchanged. Exception-workbench test 13 swaps to `noop.unknown_command`. Close Phase 1 progress item **13** and upstream spec pointers (Lock 5).

**Architecture:** Delete one `COMMAND_CATALOG` object (~856–864) and one `PROTOTYPE_ACTIONS` line (~1040). Register pins move catalog length **89** and prototype length **34**; union coverage test stays structurally identical. No `PROTOTYPE_ACTIONS_AS_SIDE_EFFECT` row — unlike `ADD_AUDIT_LOG`, there is no side-effect implementation. Historical audit rows referencing the retired `commandId` stay append-only.

**Tech Stack:** `@hospai/contracts` catalog/register tests, vitest Worker HTTP (`exception-workbench.spec.ts` test 13), guard scripts (`check:permissions`, `check:degraded`, `check:entitlements`).

**Spec:** `docs/superpowers/specs/2026-08-15-update-extras-retirement-design.md` (every Lock normative).

---

## Sequencing gate (read before starting)

This slice closes Phase 1 leftover **13** ([progress campaign](../../.superpowers/sdd/progress-phase1-leftovers.md) ~43). Split command collapse (item **12**) must land first — verified post-`1aa4b75`: catalog **90**, writers **63**, route tail `[143] get_city_ledger_statement`, prototype **35**.

| After this plan | Do not start |
|---|---|
| `COMMAND_CATALOG` length **90 → 89** | Schema migration (`PROPERTY_SCHEMA_HEAD` stays **33**) |
| `PROTOTYPE_ACTIONS` length **35 → 34** | New events, wire codes, permissions |
| `AUDIT_WRITER_COMMAND_IDS.size` **63** unchanged | `REPLAY_DISPATCH` expansion for extras |
| `V1_HTTP_ROUTE_AUDIT` length **144** unchanged | Replacement “extras” product vertical |
| `PLATFORM_GAPS === []` | `ARCHITECTURE.md` edits |

---

## Open decisions (locked — do not re-litigate)

### D1 — Frozen heads (spec §1.3)

**Locked:** `COMMAND_CATALOG` **90 → 89** — delete `reservations.update_extras` block. `PROTOTYPE_ACTIONS` **35 → 34** — delete `'UPDATE_RESERVATION_EXTRAS'`; **no** `PROTOTYPE_ACTIONS_AS_SIDE_EFFECT` row. `AUDIT_WRITER_COMMAND_IDS.size` **63** unchanged. `V1_HTTP_ROUTE_AUDIT` length **144**; `[143] = get_city_ledger_statement` unchanged. `PROPERTY_SCHEMA_HEAD` **33**. `ORG_SCHEMA_HEAD` **7**. `NIGHT_AUDIT_STEPS` length **8**. `PLATFORM_GAPS` stays `[]`.

### D2 — Physical removal (spec Locks 1–2)

**Locked:** Delete entire catalog object; do not deprecate-in-place or move to `PLATFORM_GAPS`. Neighbouring rows (`staff.delete` → `rooms.delete`) stay contiguous with no gap comment. Prototype shrink only — superseded by `ADD_FOLIO_ITEM` / `folio.add_item`; not a “not carried forward” register category.

### D3 — Exception workbench sample (spec Lock 4)

**Locked:** Test 13 `type: 'reservations.update_extras'` → `type: 'noop.unknown_command'`. Assertions (retry **422** / resolve **200**) unchanged.

### D4 — Tests / CI discipline (spec §5)

**Locked:** TDD — failing register pins before catalog delete. File-filter vitest; **no `vi.spyOn` into DO isolate.** Rebuild `@hospai/contracts` (`pnpm build`) before pms-core tests. `pnpm --filter @hospai/pms-core exec vitest run --shard=N/8` (**no `--` before `--shard`**). Workerd 503: retry that shard **once**. Never `|| true`.

### D5 — Reviewer workflow

**Locked:** Spec/plan writers do **not** commit. Implementers commit per task. Living plan checkboxes: tick **Task 2 only** at implementation time. Lock 5 pointer sentences — **Task 2 only**. No push.

---

## Global Constraints

- **`PROPERTY_SCHEMA_HEAD` stays 33** — no migration, no DDL.
- **No replacement command, no migration shim, no `PLATFORM_GAPS` entry.**
- **Do not bump audit writers** — retiring id was never in `AUDIT_WRITER_COMMAND_IDS`.
- **Do not touch** `property-do.ts`, `v1-dispatch.ts`, `v1-http-routes.ts`, `audit-writers.ts`, `replay-dispatch.ts`, `packages/client-core`, `apps/web-pms`.
- **Scope-out (forbidden all tasks):** DO/HTTP/client/SPA product changes; schema migration; new events/wire codes/permissions; `REPLAY_DISPATCH` changes; audit-log rewrite; `ARCHITECTURE.md`; push; ticking Task 1 living boxes in this plan.

---

## File map

| File | Role | Task |
|---|---|---|
| `packages/contracts/src/register.test.ts` | Pin catalog **89**, prototype **34**; coverage test title | 1 |
| `packages/contracts/src/commands/catalog.ts` | Delete catalog entry; remove `PROTOTYPE_ACTIONS` line | 1 |
| `apps/pms-core/test/exception-workbench.spec.ts` | Test 13 sample type swap | 1 |
| `docs/superpowers/specs/2026-08-11-booking-wizard-design.md` | §2.8 + §7 leftover **7** pointers | 2 |
| `docs/superpowers/specs/2026-08-12-reservations-lifecycle-completion-design.md` | §17 item **7** pointer | 2 |
| `docs/superpowers/specs/2026-08-15-booking-plan-picker-design.md` | §5 leftover **5** pointer | 2 |
| `docs/superpowers/specs/2026-08-13-exception-queue-workbench-design.md` | Optional strike leftover **16** | 2 |
| `.superpowers/sdd/progress-phase1-leftovers.md` | Item **13** DONE | 2 |
| `docs/superpowers/specs/2026-08-15-update-extras-retirement-design.md` | Tick §9 checklist | 2 |
| `docs/superpowers/plans/2026-08-15-update-extras-retirement.md` | Task 2 checkboxes (this file) | 2 |

**Not touched:** `property-migrations.ts`, `event-consumer.ts`, `v1-http-routes.ts`, `audit-writers.ts`, `entitlements.ts`, `replay-dispatch.ts`, `NIGHT_AUDIT_STEPS`, `ORG_SCHEMA_HEAD`, `ARCHITECTURE.md`.

---

## Spec §1.4 / §9 → task map

| Spec item | Task |
|---|---|
| Lock 1 — delete catalog entry | 1 |
| Lock 2 — shrink `PROTOTYPE_ACTIONS` | 1 |
| Lock 3 — register test pins | 1 |
| Lock 4 — exception workbench test 13 | 1 |
| Lock 5 — historical spec pointers | 2 |
| §9 checklist + progress item **13** | 2 |
| §1.5 scope out | forbidden all |

---

### Task 1: Contracts + tests — TDD red pins, delete rows, green CI subset

**Spec:** Locks 1–4, §5 test plan items 1–5.

**Files:**
- Modify: `packages/contracts/src/register.test.ts` (~175–176, ~751)
- Modify: `packages/contracts/src/commands/catalog.ts` (~856–864, ~1040)
- Modify: `apps/pms-core/test/exception-workbench.spec.ts` (~582)

**Interfaces:**
- Produces: catalog length **89**; prototype **34**; writers **63** unchanged
- Produces: zero hits for `reservations.update_extras` / `UPDATE_RESERVATION_EXTRAS` in `apps/`, `packages/`, `scripts/`

**Forbidden this commit:** Doc pointer sentences; progress file; ticking Task 2 boxes.

- [ ] **Step 1: Update `register.test.ts` pin targets (TDD red)**

Prototype coverage test (~175–176):

```typescript
  it('covers all 34 prototype actions (catalog ∪ side-effect exemptions)', () => {
    expect(PROTOTYPE_ACTIONS).toHaveLength(34);
```

Night-audit HTTP routes block (~750–751) — **only** catalog length changes; writers pin stays **63**:

```typescript
    expect(AUDIT_WRITER_COMMAND_IDS.size).toBe(63);
    expect(COMMAND_CATALOG).toHaveLength(89);
```

No other `register.test.ts` edits (grep confirms no `update_extras` / `UPDATE_RESERVATION_EXTRAS` assertions elsewhere).

- [ ] **Step 2: Run register tests to verify they fail**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "covers all|night-audit HTTP routes"
```

Expected: **FAIL** — catalog still **90**; `PROTOTYPE_ACTIONS` still **35**.

- [ ] **Step 3: Delete catalog entry (Lock 1)**

In `packages/contracts/src/commands/catalog.ts`, remove entire block (~856–864):

```typescript
  {
    id: 'reservations.update_extras',
    prototypeAction: 'UPDATE_RESERVATION_EXTRAS',
    lane: 'INTERACTIVE',
    degraded: 'QUEUE_PROVISIONAL',
    idempotent: true,
    events: ['reservation.modified'],
    permission: 'reservations:write',
  },
```

Verify neighbours contiguous: `staff.delete` (~848) immediately followed by `rooms.delete` (~865).

- [ ] **Step 4: Remove `PROTOTYPE_ACTIONS` line (Lock 2)**

Delete (~1040):

```typescript
  'UPDATE_RESERVATION_EXTRAS',
```

Do **not** add `PROTOTYPE_ACTIONS_AS_SIDE_EFFECT` entry.

- [ ] **Step 5: Swap exception workbench test 13 sample (Lock 4)**

In `apps/pms-core/test/exception-workbench.spec.ts` (~582):

```typescript
      sampleCmd({ propertyId, orgId, businessDate: arrival, type: 'noop.unknown_command', payload: {} }),
```

Assertions ~587–591 unchanged.

- [ ] **Step 6: Rebuild contracts + run targeted tests**

```bash
pnpm build
pnpm --filter @hospai/contracts test
pnpm --filter @hospai/pms-core exec vitest run test/exception-workbench.spec.ts -t "13:"
pnpm check:permissions
pnpm check:degraded
pnpm check:entitlements
```

Expected:
- Register: catalog **89**, prototype **34**, writers **63** — **PASS**
- Test 13: retry **422** / resolve **200** — **PASS**
- `check:permissions`: log shows **89** catalog entries — **PASS**
- `check:degraded`: route count **144** — **PASS**
- `check:entitlements`: no opt-out / writer pairing change — **PASS**

- [ ] **Step 7: Grep clean**

```bash
rg 'reservations\.update_extras|UPDATE_RESERVATION_EXTRAS' apps/ packages/ scripts/
```

Expected: **zero** hits.

- [ ] **Step 8: Commit**

```bash
git add packages/contracts/src/commands/catalog.ts \
  packages/contracts/src/register.test.ts \
  apps/pms-core/test/exception-workbench.spec.ts
git commit -m "$(cat <<'EOF'
refactor(contracts): retire reservations.update_extras

EOF
)"
```

---

### Task 2: Pointers + final verification

**Spec:** Lock 5, §9 checklist, D4/D5.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-11-booking-wizard-design.md` (~141, ~293)
- Modify: `docs/superpowers/specs/2026-08-12-reservations-lifecycle-completion-design.md` (~855)
- Modify: `docs/superpowers/specs/2026-08-15-booking-plan-picker-design.md` (~268)
- Modify: `.superpowers/sdd/progress-phase1-leftovers.md` (~43, ~52)
- Modify: `docs/superpowers/specs/2026-08-15-update-extras-retirement-design.md` — tick §9
- Modify: `docs/superpowers/plans/2026-08-15-update-extras-retirement.md` — Task 2 checkboxes only
- Optional: `docs/superpowers/specs/2026-08-13-exception-queue-workbench-design.md` (~515) — strike leftover **16**

**Pointer sentences (normative — verbatim from spec Lock 5):**

`docs/superpowers/specs/2026-08-11-booking-wizard-design.md` §2.8 bullet (~141) — append after existing bullet text or replace bullet body:

> **Closed** in [update extras retirement](./2026-08-15-update-extras-retirement-design.md): catalog row and `UPDATE_RESERVATION_EXTRAS` removed; desk extras use `folio.add_item` / charge codes.

§7 leftover **7** row (~293) — replace deferred `update_extras` clause:

> **`update_extras` closed in [update extras retirement](./2026-08-15-update-extras-retirement-design.md); `update_status` retargeted 2026-08-12.**

`docs/superpowers/specs/2026-08-12-reservations-lifecycle-completion-design.md` §17 item **7** (~855):

> **Closed** in [update extras retirement](./2026-08-15-update-extras-retirement-design.md).

`docs/superpowers/specs/2026-08-15-booking-plan-picker-design.md` §5 leftover **5** row (~268):

> **Closed** in [update extras retirement](./2026-08-15-update-extras-retirement-design.md).

`.superpowers/sdd/progress-phase1-leftovers.md` item **13** (~43) — same pattern as item **12**:

> **13. Retire `reservations.update_extras`** — DONE `<commit-hash>` (spec `…`, plan `…`; catalog 89, prototype 34).

Also update queue line ~52 hygiene row to DONE or strike (catalog debt closed).

Optional — `docs/superpowers/specs/2026-08-13-exception-queue-workbench-design.md` leftover **16** (~515):

> ~~16. `REPLAY_DISPATCH` + `reservations.update_extras` …~~ **Moot** — id removed in [update extras retirement](./2026-08-15-update-extras-retirement-design.md).

- [x] **Step 1: Pin frozen heads**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "covers all|night-audit HTTP routes|PLATFORM_GAPS"
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "schema head constants"
```

Expect: catalog **89**; prototype **34**; writers **63**; `[143]=get_city_ledger_statement`; `PROPERTY_SCHEMA_HEAD === 33`; `PLATFORM_GAPS === []`.

- [x] **Step 2: Targeted test superset**

```bash
pnpm build
pnpm --filter @hospai/contracts test
pnpm --filter @hospai/pms-core exec vitest run test/exception-workbench.spec.ts -t "13:"
pnpm check:permissions
pnpm check:degraded
pnpm check:entitlements
rg 'reservations\.update_extras|UPDATE_RESERVATION_EXTRAS' apps/ packages/ scripts/
```

Expected: **PASS**; grep **zero** hits in code paths.

- [x] **Step 3: Full CI sequence**

```bash
pnpm build
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
pnpm typecheck
pnpm exec turbo run test --filter=!@hospai/pms-core
pnpm lint
pnpm --filter @hospai/pms-core exec vitest run --shard=1/8
pnpm --filter @hospai/pms-core exec vitest run --shard=2/8
pnpm --filter @hospai/pms-core exec vitest run --shard=3/8
pnpm --filter @hospai/pms-core exec vitest run --shard=4/8
pnpm --filter @hospai/pms-core exec vitest run --shard=5/8
pnpm --filter @hospai/pms-core exec vitest run --shard=6/8
pnpm --filter @hospai/pms-core exec vitest run --shard=7/8
pnpm --filter @hospai/pms-core exec vitest run --shard=8/8
```

If any shard fails with workerd 503, retry that shard once. Do not `|| true`.

- [x] **Step 4: Apply doc pointers + tick retirement spec §9 checklist**

Tick every item in `docs/superpowers/specs/2026-08-15-update-extras-retirement-design.md` §9.

- [x] **Step 5: Tick Task 2 checkboxes in this plan only**

Do **not** tick Task 1 checkboxes retroactively unless already done during implementation.

- [x] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-08-11-booking-wizard-design.md \
  docs/superpowers/specs/2026-08-12-reservations-lifecycle-completion-design.md \
  docs/superpowers/specs/2026-08-15-booking-plan-picker-design.md \
  docs/superpowers/specs/2026-08-13-exception-queue-workbench-design.md \
  .superpowers/sdd/progress-phase1-leftovers.md \
  docs/superpowers/specs/2026-08-15-update-extras-retirement-design.md \
  docs/superpowers/plans/2026-08-15-update-extras-retirement.md
git commit -m "$(cat <<'EOF'
docs: close update_extras retirement leftovers

EOF
)"
```

**Stop.** Phase 1 progress item **13** closed. No schema migration. No new events or permissions.

---

## Spec §9 reviewer checklist (Task 2 ticks these in the spec file when CI is green)

| §9 item | Satisfied by |
|---|---|
| Delete catalog entry + `PROTOTYPE_ACTIONS` line | 1 |
| Register pins **89** / **34**; writers **63** unchanged | 1 |
| Exception workbench test 13 `noop.unknown_command` | 1 |
| Guard scripts green | 1, 2 |
| Grep clean `apps/` / `packages/` / `scripts/` | 1, 2 |
| Lock 5 pointer sentences + progress item **13** DONE | 2 |

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| §1.4 scope in (1–5) | 1, 2 |
| §1.5 scope out | forbidden all |
| §2 Locks 1–5 | 1, 2 |
| §7 file map | 1, 2 |
| §9 checklist + pointers | 2 |
| Heads table §1.3 | 1 + 2 verify |
| D-locks 1–5 | Open decisions |

**Gaps:** None — spec scope fully mapped.

**Placeholder scan:** Progress item **13** commit hash filled at Task 2 commit time (same pattern as item **12**).

**Tree conflicts:** None (spec §10). Verified post-split-collapse: catalog **90**, writers **63**, route tail `[143] get_city_ledger_statement`, prototype **35** (includes `'UPDATE_RESERVATION_EXTRAS'`), retiring row ~856–864, workbench test 13 uses retiring id, `PROPERTY_SCHEMA_HEAD` **33**.

**Implementer notes (from spec §10, not lock violations):**

1. **Do not add `PROTOTYPE_ACTIONS_AS_SIDE_EFFECT` for extras** — reviewer locked shrink, not reclassify.
2. **Do not bump audit writers** — row never had entitlement-gated writer path.
3. **`noop.unknown_command` is canonical** — any non-catalog id with same replay behaviour acceptable if tests stay green.
4. **Union coverage test body unchanged** — only length pin and title; side-effect exemption for `ADD_AUDIT_LOG` stays.
