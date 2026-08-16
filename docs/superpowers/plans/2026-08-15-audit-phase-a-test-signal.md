# Audit Phase A — restore trustworthy test signal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Draft (plan writer, 2026-08-15)
>
> **Spec/plan writers do not commit.** Implementers commit per task. Work on `main`. No push.

**Goal:** Restore a trustworthy local test signal for audit Phase **A** only: **A1** property-scope three flaky console absence assertions; **A2** add root `test:local` (non-pms-core turbo + sequential 8-way pms-core shards); point README pre-push table at `test:local`; hygiene stale `N/4` shard references in the audit doc. No product code, catalog, route, schema, timeout, seed, or CI workflow changes. Heads frozen.

**Architecture:** A1 fixes cross-property console pollution under `singleWorker` + `isolatedStorage: false` by adding the same `property_id` conjunct already used at `observability.spec.ts:339`. A2 mirrors CI shard **width** (8) via `scripts/test-pms-core-shards.mjs` — local shards include `reservations-ledger.property.spec.ts` (CI excludes it into a separate job). Root `"test": "turbo run test"` unchanged.

**Tech Stack:** vitest + `vitest-pool-workers` (`apps/pms-core`), root `package.json` scripts, Node `spawnSync`, audit/README docs.

**Spec:** `docs/superpowers/specs/2026-08-15-audit-phase-a-test-signal-design.md` (Locks 1–4 normative).

---

## Frozen heads (do not move this chunk)

| Head | Current | This chunk |
|---|---|---|
| `COMMAND_CATALOG` | length **89** | **89** |
| `AUDIT_WRITER_COMMAND_IDS.size` | **63** | **63** |
| `V1_HTTP_ROUTE_AUDIT` | `[143] get_city_ledger_statement` | unchanged |
| `PROPERTY_SCHEMA_HEAD` | **33** | **33** |
| `NIGHT_AUDIT_STEPS` | length **8**; `[3] AUTO_TRANSFER` | unchanged |

Tree verified 2026-08-15. CI matrix already runs **8** pms-core shards (`.github/workflows/ci.yml` `test-pms-core`).

---

## Sequencing gate (read before starting)

Phase **A** must land before any Phase **B+** audit remediation — local verification is unreliable until A1/A2 complete.

| After this plan | Do not start |
|---|---|
| Three scoped absence assertions (A1) | A1 lint/check follow-up script |
| `pnpm test:local` + shard script (A2) | Root `pnpm test` script behaviour change |
| README pre-push table → `test:local` | Timeout / `LEDGER_PROP_SEED` / seed-count changes |
| Audit doc `N/4` → `N/8` / `test:local` | Product code, catalog, routes, schema migrations |
| All §Verification commands green | Phase **B+** audit items; CI workflow edits |

**TDD order:** Task 1 (A1) → verify three-file vitest → Task 2–4 → full verification.

---

## Open decisions (locked — do not re-litigate)

### D1 — Lock 1: A1 scoped absence assertions (spec §2 Lock 1)

**Locked:** Exactly three one-line edits. Do not refactor capture helpers or touch other console-spy spec files.

| # | File:line | Before | After |
|---|---|---|---|
| 1 | `apps/pms-core/test/observability.spec.ts:374` | `expect(capture.lines.some((l) => l.msg === 'outbox.flush')).toBe(false);` | `expect(capture.lines.some((l) => l.msg === 'outbox.flush' && l.property_id === name)).toBe(false);` |
| 2 | `apps/pms-core/test/lane-guard.spec.ts:88` | `expect(capture.lines.some((l) => l.msg === 'outbox.flush')).toBe(false);` | `expect(capture.lines.some((l) => l.msg === 'outbox.flush' && l.property_id === name)).toBe(false);` |
| 3 | `apps/pms-core/test/reservations-routes.spec.ts:295` | `expect(lines.some((l) => l.msg === 'ari.reject_on_commit')).toBe(false);` | `expect(lines.some((l) => l.msg === 'ari.reject_on_commit' && l.property_id === propertyId)).toBe(false);` |

Scope keys: **`name`** in observability/lane-guard (`lg_defer_…` defer test); **`propertyId`** in reservations-routes (`provisionHotel` binding) — not `name`.

### D2 — Lock 2: `test:local` script pair (spec §2 Lock 2)

**Locked:** Root `package.json` add:

```json
"test:local": "pnpm exec turbo run test --filter=!@hospai/pms-core && node scripts/test-pms-core-shards.mjs"
```

**Locked:** New `scripts/test-pms-core-shards.mjs` — sequential **8** shards, stdio inherit, exit on first failure, **no `--` before `--shard`**, **no `--exclude`**. Do **not** change `"test": "turbo run test"`.

### D3 — Lock 3: README pre-push table (spec §2 Lock 3)

**Locked:** In **"CI runs these in order (run them before pushing)"** table only: row `pnpm test` → `pnpm test:local`. Add one sentence immediately after the table (verbatim):

> `pnpm test` unsharded segfaults workerd locally; `test:local` shards pms-core 8 ways to match CI. The sold-ledger property spec runs in a separate CI job but is included in local shards.

**Locked:** Leave `README.md:11` `# primary loop` (`pnpm test`) unchanged.

### D4 — Lock 4: Audit doc shard staleness (spec §2 Lock 4)

**Locked:** Edit `docs/audit/2026-08-15-full-codebase-audit.md` at four locations — ground rules §3, A1 Verify block, A2 Fix bullet, appendix Tests block — all `N/4` → `N/8` / `test:local`.

### D5 — CI discipline (normative — all tasks)

**Locked:** `pnpm --filter @hospai/pms-core exec vitest run --shard=N/8` with **no `--` before `--shard`**. Workerd 503 → retry that shard once. Never `|| true`. Never unsharded `pnpm --filter @hospai/pms-core test`.

### D6 — Reviewer workflow

**Locked:** Spec/plan writers do **not** commit. Implementers commit per task. Living plan checkboxes: tick **Task 4 only** at implementation time. No push.

---

## Global constraints

- **Heads table above — no catalog/route/schema/night-audit movement.**
- **Test-infra + docs only** — no `apps/pms-core/src/**`, `packages/**`, `vitest.config.ts`, migrations, `ARCHITECTURE.md`, `.github/workflows/ci.yml`.
- **Local shards = 8**, not audit's stale **4** — matches live CI matrix width.
- **Local includes ledger property spec** in shard partition; CI `test-pms-core` excludes it (separate `test-pms-core-ledger-prop` job) — document in script comment + README sentence only.

### Scope out (forbidden across all tasks)

- A1 lint/check follow-up script rejecting unscoped `.some((l) => l.msg === …)` inside console captures
- Any change to root `pnpm test` script behaviour (README pointer only)
- Timeout changes, `LEDGER_PROP_SEED` changes, seed-count changes
- Product code, catalog, HTTP routes, schema migrations
- Phase **B** and later audit items
- CI workflow edits (already at 8 shards)

---

## File map

| File | Role | Task |
|---|---|---|
| `apps/pms-core/test/observability.spec.ts` | Line 374 — add `&& l.property_id === name` | 1 |
| `apps/pms-core/test/lane-guard.spec.ts` | Line 88 — add `&& l.property_id === name` | 1 |
| `apps/pms-core/test/reservations-routes.spec.ts` | Line 295 — add `&& l.property_id === propertyId` | 1 |
| `scripts/test-pms-core-shards.mjs` | **New** — 8-shard sequential runner | 2 |
| `package.json` | Add `test:local` script | 2 |
| `README.md` | Pre-push table row + one sentence after table | 3 |
| `docs/audit/2026-08-15-full-codebase-audit.md` | Ground rules §3, A1 Verify, A2 Fix, appendix Tests | 4 |
| `docs/superpowers/plans/2026-08-15-audit-phase-a-test-signal.md` | Task 4 checkboxes (this file) | 4 |

**Not touched:** `apps/pms-core/src/**`, `packages/**`, `vitest.config.ts`, `.github/workflows/ci.yml`, migrations, `ARCHITECTURE.md`, root `"test"` script.

---

## Spec §1.5 / §9 → task map

| Spec item | Task |
|---|---|
| Lock 1 — three scoped absence fixes | 1 |
| Lock 2 — shard script + `test:local` | 2 |
| Lock 3 — README table + sentence | 3 |
| Lock 4 — audit doc `N/4` hygiene | 4 |
| §5 test plan verification | 1 + 4 |
| §1.6 scope out | forbidden all |

---

### Task 1: A1 — scoped absence assertions (TDD)

**Spec:** Lock 1, §5 test plan #1.

**Files:**
- Modify: `apps/pms-core/test/observability.spec.ts` (~374)
- Modify: `apps/pms-core/test/lane-guard.spec.ts` (~88)
- Modify: `apps/pms-core/test/reservations-routes.spec.ts` (~295)

**Interfaces:**
- Produces: three property-scoped absence assertions matching `observability.spec.ts:339` pattern
- Frozen heads unchanged (test-only)

**Forbidden this commit:** Shard script, `package.json`, README, audit doc.

- [ ] **Step 1: Baseline — run three files (observe green/red under full-suite flake)**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/observability.spec.ts test/lane-guard.spec.ts test/reservations-routes.spec.ts
```

Note pass/fail; intermittent red on unscoped lines confirms A1 mechanism.

- [ ] **Step 2: Apply Lock 1 one-liners**

`apps/pms-core/test/observability.spec.ts` (~374):

```typescript
    expect(capture.lines.some((l) => l.msg === 'outbox.flush' && l.property_id === name)).toBe(false);
```

`apps/pms-core/test/lane-guard.spec.ts` (~88):

```typescript
    expect(capture.lines.some((l) => l.msg === 'outbox.flush' && l.property_id === name)).toBe(false);
```

`apps/pms-core/test/reservations-routes.spec.ts` (~295):

```typescript
    expect(lines.some((l) => l.msg === 'ari.reject_on_commit' && l.property_id === propertyId)).toBe(false);
```

- [ ] **Step 3: Re-run three-file vitest — must be green**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/observability.spec.ts test/lane-guard.spec.ts test/reservations-routes.spec.ts
```

Expected: **PASS** (all three files).

- [ ] **Step 4: Commit**

```bash
git add apps/pms-core/test/observability.spec.ts \
  apps/pms-core/test/lane-guard.spec.ts \
  apps/pms-core/test/reservations-routes.spec.ts
git commit -m "$(cat <<'EOF'
test(pms-core): scope console absence assertions by property

EOF
)"
```

---

### Task 2: A2 — shard script + `test:local`

**Spec:** Lock 2.

**Files:**
- Create: `scripts/test-pms-core-shards.mjs`
- Modify: `package.json` (add `test:local` after `"test"`)

**Interfaces:**
- Produces: sequential 8-shard local runner; root `pnpm test:local`
- `"test": "turbo run test"` unchanged

**Forbidden this commit:** README, audit doc; `--exclude` in shard script; `--` before `--shard`.

- [ ] **Step 1: Create `scripts/test-pms-core-shards.mjs` (Lock 2 verbatim)**

```js
#!/usr/bin/env node
/**
 * Run @hospai/pms-core vitest in 8 sequential shards (matches CI matrix width).
 *
 * Do NOT put `--` before --shard: pnpm forwards a bare `--`, and vitest
 * then treats --shard as a file filter — every shard silently runs the full suite.
 *
 * CI test-pms-core excludes test/reservations-ledger.property.spec.ts (separate
 * test-pms-core-ledger-prop job). This script has NO --exclude so local shards
 * cover the full spec tree including the ledger property spec.
 */
import { spawnSync } from 'node:child_process';

const SHARD_COUNT = 8;

for (let shard = 1; shard <= SHARD_COUNT; shard++) {
  const result = spawnSync(
    'pnpm',
    [
      '--filter',
      '@hospai/pms-core',
      'exec',
      'vitest',
      'run',
      `--shard=${shard}/${SHARD_COUNT}`,
    ],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
```

- [ ] **Step 2: Add `test:local` to root `package.json`**

After `"test": "turbo run test",`:

```json
    "test:local": "pnpm exec turbo run test --filter=!@hospai/pms-core && node scripts/test-pms-core-shards.mjs",
```

- [ ] **Step 3: Smoke — shard script alone (shard 1)**

```bash
node scripts/test-pms-core-shards.mjs
```

Expected: runs shards 1–8 sequentially; exits non-zero on first failure. *(Long pole — may skip full run here; Task 4 verifies `pnpm test:local`.)*

Optional quick partition check:

```bash
for s in 1 2 3 4 5 6 7 8; do
  pnpm --filter @hospai/pms-core exec vitest list --shard=$s/8
done
```

Expected: no empty shards; `test/reservations-ledger.property.spec.ts` appears in exactly one shard listing.

- [ ] **Step 4: Commit**

```bash
git add scripts/test-pms-core-shards.mjs package.json
git commit -m "$(cat <<'EOF'
chore: add test:local with 8-way pms-core shard runner

EOF
)"
```

---

### Task 3: README pre-push table

**Spec:** Lock 3.

**Files:**
- Modify: `README.md` (~28–29 only for table row; sentence after table)

**Forbidden this commit:** `README.md:11` `# primary loop`; other README sections.

- [ ] **Step 1: Replace pre-push table test row**

Before (~28):

```markdown
| `pnpm test` | Behaviour (~800+ tests across packages; pms-core sharded in CI) |
```

After:

```markdown
| `pnpm test:local` | Behaviour (~800+ tests across packages; pms-core sharded 8 ways locally) |
```

- [ ] **Step 2: Add sentence immediately after the table (before `## PR invariants`)**

```markdown
`pnpm test` unsharded segfaults workerd locally; `test:local` shards pms-core 8 ways to match CI. The sold-ledger property spec runs in a separate CI job but is included in local shards.
```

- [ ] **Step 3: Confirm line 11 unchanged**

```bash
sed -n '11p' README.md
```

Expected: `pnpm test          # primary loop`

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs(readme): point pre-push table at test:local

EOF
)"
```

---

### Task 4: Audit doc hygiene + final verification

**Spec:** Lock 4, §5 test plan #2–#6, §9 checklist.

**Files:**
- Modify: `docs/audit/2026-08-15-full-codebase-audit.md` (four locations)
- Modify: `docs/superpowers/specs/2026-08-15-audit-phase-a-test-signal-design.md` — tick §9
- Modify: `docs/superpowers/plans/2026-08-15-audit-phase-a-test-signal.md` — Task 4 checkboxes only

- [x] **Step 1: Ground rules §3 (~24–28)**

Replace:

```markdown
3. **Run the local suite in shards.** `pnpm test` unsharded segfaults (see `A2`). Until `A2` lands, use:
   ```bash
   pnpm --filter @hospai/pms-core exec vitest run --shard=1/4
   ```
   Note: **no `--` before `--shard`** — pnpm forwards a bare `--` and vitest then treats `--shard` as a file filter, silently running the full suite in every shard.
```

With:

```markdown
3. **Run the local suite in shards.** `pnpm test` unsharded segfaults (see `A2`). Use `pnpm test:local` **or** manual shards:
   ```bash
   pnpm test:local
   # or: pnpm --filter @hospai/pms-core exec vitest run --shard=1/8  # … through 8/8
   ```
   Local runner uses **8** shards to match CI (`test-pms-core` matrix). Note: **no `--` before `--shard`** — pnpm forwards a bare `--` and vitest then treats `--shard` as a file filter, silently running the full suite in every shard.
```

- [x] **Step 2: A1 Verify block (~80–87)**

Replace four-shard block:

```bash
pnpm --filter @hospai/pms-core exec vitest run --shard=1/4
pnpm --filter @hospai/pms-core exec vitest run --shard=2/4
pnpm --filter @hospai/pms-core exec vitest run --shard=3/4
pnpm --filter @hospai/pms-core exec vitest run --shard=4/4
```

With:

```bash
pnpm --filter @hospai/pms-core exec vitest run test/observability.spec.ts test/lane-guard.spec.ts test/reservations-routes.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=1/8
pnpm --filter @hospai/pms-core exec vitest run --shard=2/8
pnpm --filter @hospai/pms-core exec vitest run --shard=3/8
pnpm --filter @hospai/pms-core exec vitest run --shard=4/8
pnpm --filter @hospai/pms-core exec vitest run --shard=5/8
pnpm --filter @hospai/pms-core exec vitest run --shard=6/8
pnpm --filter @hospai/pms-core exec vitest run --shard=7/8
pnpm --filter @hospai/pms-core exec vitest run --shard=8/8
```

Update trailing prose: *"All eight green, repeated twice."* (was four).

- [x] **Step 3: A2 Fix bullet (~115)**

Replace:

```markdown
   The script runs `vitest run --shard=N/4` for N=1..4 in sequence, exits non-zero on the first failure. Keep the "no `--` before `--shard`" note as a comment in the script — it is a real, silent footgun.
```

With:

```markdown
   The script runs `vitest run --shard=N/8` for N=1..8 in sequence (`scripts/test-pms-core-shards.mjs`), exits non-zero on the first failure. Keep the "no `--` before `--shard`" note as a comment in the script — it is a real, silent footgun.
```

Also update A2 README bullet (~117) to match Lock 3 sentence (8-way + sold-ledger note) if still stale.

- [x] **Step 4: Appendix Tests block (~815–823)**

Replace:

```markdown
Tests — **sharded**, until `A2` lands (no `--` before `--shard`):

```bash
pnpm exec turbo run test --filter=!@hospai/pms-core
pnpm --filter @hospai/pms-core exec vitest run --shard=1/4
pnpm --filter @hospai/pms-core exec vitest run --shard=2/4
pnpm --filter @hospai/pms-core exec vitest run --shard=3/4
pnpm --filter @hospai/pms-core exec vitest run --shard=4/4
```
```

With:

```markdown
Tests — **sharded** (no `--` before `--shard`):

```bash
pnpm test:local
# or manually:
pnpm exec turbo run test --filter=!@hospai/pms-core
pnpm --filter @hospai/pms-core exec vitest run --shard=1/8
pnpm --filter @hospai/pms-core exec vitest run --shard=2/8
pnpm --filter @hospai/pms-core exec vitest run --shard=3/8
pnpm --filter @hospai/pms-core exec vitest run --shard=4/8
pnpm --filter @hospai/pms-core exec vitest run --shard=5/8
pnpm --filter @hospai/pms-core exec vitest run --shard=6/8
pnpm --filter @hospai/pms-core exec vitest run --shard=7/8
pnpm --filter @hospai/pms-core exec vitest run --shard=8/8
```
```

- [x] **Step 5: A1 three-file vitest (spec §5 #1)**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/observability.spec.ts test/lane-guard.spec.ts test/reservations-routes.spec.ts
```

Expected: **PASS**.

- [x] **Step 6: Full local test loop — long pole (spec §5 #2)**

```bash
pnpm test:local
```

Expected: non-pms-core turbo tests + all **8** pms-core shards green. Run twice if feasible.

**Fallback** if local runner too slow (spec §5 #2b): Step 5 green **and**:

```bash
for s in 1 2 3 4 5 6 7 8; do
  pnpm --filter @hospai/pms-core exec vitest list --shard=$s/8
done
```

Confirm partition covers full spec set with no empty shards; `test/reservations-ledger.property.spec.ts` in exactly one shard.

- [x] **Step 7: All 14 `check:*` gates (spec §5 #3)**

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

- [x] **Step 8: typecheck / build / lint (spec §5 #4–#6)**

```bash
pnpm typecheck
pnpm build
pnpm lint
```

Expected: all **PASS**.

- [x] **Step 9: Pin frozen heads (sanity — should be unchanged)**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes|PLATFORM_GAPS"
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "schema head constants"
```

Expect: catalog **89**; writers **63**; `[143]=get_city_ledger_statement`; `PROPERTY_SCHEMA_HEAD === 33`; `NIGHT_AUDIT_STEPS` length **8**, `[3] AUTO_TRANSFER`.

- [x] **Step 10: Tick spec §9 checklist**

Tick every item in `docs/superpowers/specs/2026-08-15-audit-phase-a-test-signal-design.md` §9.

- [x] **Step 11: Tick Task 4 checkboxes in this plan only**

Do **not** tick Task 1–3 checkboxes retroactively unless already done during implementation.

- [x] **Step 12: Commit**

```bash
git add docs/audit/2026-08-15-full-codebase-audit.md \
  docs/superpowers/specs/2026-08-15-audit-phase-a-test-signal-design.md \
  docs/superpowers/plans/2026-08-15-audit-phase-a-test-signal.md
git commit -m "$(cat <<'EOF'
docs: audit Phase A shard hygiene and verification path

EOF
)"
```

**Stop.** Phase **A** test signal restored. Phase **B+** audit items remain separate verticals.

---

## Verification (plan-level summary)

| # | Command / assertion | Expectation | Task |
|---|---|---|---|
| 1 | `pnpm --filter @hospai/pms-core exec vitest run test/observability.spec.ts test/lane-guard.spec.ts test/reservations-routes.spec.ts` | Green — proves A1 | 1, 4 |
| 2 | `pnpm test:local` on clean tree | **Long pole** — 8 shards + non-pms-core green; run twice if feasible | 4 |
| 2b | *(fallback)* Step 1 green + `vitest list --shard=$s/8` for `s=1..8` | Full partition; no empty shards; ledger spec in one shard | 4 |
| 3 | All 14 `check:*` gates | Green | 4 |
| 4 | `pnpm typecheck` | Green | 4 |
| 5 | `pnpm build` | Green | 4 |
| 6 | `pnpm lint` | Green | 4 |

---

## CI discipline (verbatim — implementers)

`pnpm --filter @hospai/pms-core exec vitest run --shard=N/8` with **no `--` before `--shard`**. Workerd 503 → retry that shard once. Never `|| true`. Never unsharded `pnpm --filter @hospai/pms-core test`.

---

## Spec §9 reviewer checklist (Task 4 ticks spec file when CI is green)

| §9 item | Satisfied by |
|---|---|
| A1: three scoped absence fixes | 1 |
| A2: `scripts/test-pms-core-shards.mjs` | 2 |
| A2: `package.json` `test:local` | 2 |
| README pre-push table + sentence | 3 |
| Audit doc `N/4` → `N/8` / `test:local` | 4 |
| Verify §5 commands green | 4 |

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| §1.5 scope in (A1–A2, README, audit hygiene) | 1–4 |
| §1.6 scope out | forbidden all |
| §2 Locks 1–4 | 1–4 |
| §5 test plan | 1, 4 |
| §7 file map | 1–4 |
| §9 checklist | 4 |
| Frozen heads §1.4 | unchanged all tasks |

**Gaps:** None — spec scope fully mapped.

**Tree conflicts:** None (spec §10). Chunk is test-only + docs/scripts; catalog **89**, writers **63**, route tail `[143]`, schema **33**, night-audit **8** unchanged.

**Implementer notes:**

1. **CI vs local ledger spec** — local shards include `reservations-ledger.property.spec.ts`; CI excludes into `test-pms-core-ledger-prop`. Not a bug; documented in script comment + README.
2. **`README.md:11` stays `pnpm test`** — Lock 3 is table + sentence only.
3. **Do not add A1 lint follow-up** — explicitly scope-out.
