# Audit Phase A — restore trustworthy test signal

**Tree verified 2026-08-15:** `COMMAND_CATALOG` length **89**, `AUDIT_WRITER_COMMAND_IDS.size === 63`, `V1_HTTP_ROUTE_AUDIT[143].id === 'get_city_ledger_statement'`, `PROPERTY_SCHEMA_HEAD === 33`, `NIGHT_AUDIT_STEPS` length **8**, `[3] === 'AUTO_TRANSFER'`. CI matrix: **8** pms-core shards (`.github/workflows/ci.yml` `test-pms-core`).

**Date:** 2026-08-15  
**Status:** Draft (spec writer)  
**Sources:** [Full codebase audit — remediation plan](../../audit/2026-08-15-full-codebase-audit.md) Phase **A** items **A1** / **A2**; ground rules (audit §Ground rules); appendix verification block; `.github/workflows/ci.yml` `test-pms-core` / `test-pms-core-ledger-prop`.

**Closes:** Audit **A1** (three unscoped console absence assertions) and **A2** (local primary test loop segfaults). **Amends:** audit doc shard references (`N/4` → `N/8`) and post-A2 verification path; `README.md` pre-push table. **Does not** advance Phase B or later audit items.

---

## Executive summary

Phase A is test-infra only: restore a **trustworthy local signal** so every later audit remediation can be verified. **A1** fixes three flaky absence assertions that spy on the globally shared `console` under `singleWorker` + `isolatedStorage: false` — each must filter by the property the test created, matching the scoped pattern already at `observability.spec.ts:339`. **A2** adds root `test:local` (non-pms-core turbo tests + sequential **8-way** pms-core shards via `scripts/test-pms-core-shards.mjs`) and points the README pre-push table at it. No product code, catalog, route, schema, timeout, or seed changes. Heads frozen.

---

## 1. Context & motivation

### 1.1 Problem statement

| Item | Symptom | Root cause |
|---|---|---|
| **A1** | Intermittent red on `lane-guard.spec.ts:88` in full runs; same file green in isolation (`1 failed \| 302 passed` during audit) | Three tests assert a log message did **not** appear on the **global** `console` capture without scoping to their property; other properties' 30s outbox alarms emit `outbox.flush` into the same channel |
| **A2** | `pnpm test` / unsharded `vitest run` in `apps/pms-core` segfaults workerd; README lists `pnpm test` as the pre-push loop | Documented primary loop cannot complete locally; workaround lived only in dated plan files, not README |

Until Phase A lands, the team habit is *run the file I touched, push, re-run CI* — and **A1** makes CI shards intermittently red, so real regressions slip through.

### 1.2 Correct pattern (already in tree)

`apps/pms-core/test/observability.spec.ts:339`:

```ts
expect(
  capture.lines.some((l) => l.msg === 'outbox.flush' && l.property_id === name),
).toBe(false);
```

Six spec files install a global `console` spy; three **presence** assertions are already scoped. Three **absence** assertions dropped the conjunct.

### 1.3 CI shard baseline (locked — not audit's `N/4`)

Audit was written when local guidance used **4** shards. CI now runs **8** (`matrix.shard: [1..8]`). Local `test:local` must match **8**, not the audit's literal `N/4`.

**CI vs local ledger spec (explicit — do not diverge by accident):**

| Job | Command shape | `reservations-ledger.property.spec.ts` |
|---|---|---|
| `test-pms-core` (8 matrix jobs) | `--shard=N/8 --exclude test/reservations-ledger.property.spec.ts` | **Excluded** — sold-ledger five-seed sequences saturate the shared events queue |
| `test-pms-core-ledger-prop` | `vitest run test/reservations-ledger.property.spec.ts` only | **Isolated** |
| **`test:local` shards** | `--shard=N/8` (**no** `--exclude`) | **Included** in whichever shard vitest assigns — local runs the **union** of CI coverage |

### 1.4 Heads (frozen — this chunk moves nothing)

| Head | Current | This chunk |
|---|---|---|
| `COMMAND_CATALOG` | length **89** | **89** |
| `AUDIT_WRITER_COMMAND_IDS.size` | **63** | **63** |
| `V1_HTTP_ROUTE_AUDIT` | `[143] get_city_ledger_statement` | unchanged |
| `PROPERTY_SCHEMA_HEAD` | **33** | **33** |
| `NIGHT_AUDIT_STEPS` | length **8**; `[3] AUTO_TRANSFER` | unchanged |

### 1.5 Scope in

1. **A1** — property-scope three absence assertions (Lock 1).
2. **A2** — `package.json` `test:local` + `scripts/test-pms-core-shards.mjs` (Lock 2).
3. **A2** — `README.md` pre-push table + explanatory sentence (Lock 3).
4. **Audit doc hygiene** — update stale `N/4` shard references to `N/8` and post-A2 verification path (Lock 4).

### 1.6 Scope out (normative)

- Optional lint / `check:` script rejecting unscoped `.some((l) => l.msg === …)` inside console captures (**A1 follow-up**)
- Any change to root `pnpm test` script behaviour (README pointer only)
- Timeout changes, `LEDGER_PROP_SEED` changes, seed-count changes
- Product code, catalog, HTTP routes, schema migrations
- Phase **B** and later audit items
- CI workflow edits (already at 8 shards)

---

## 2. Locked decisions (verbatim — do not deviate)

### Lock 1 — A1 scoped absence assertions

Apply **exactly** these three one-line edits. Do not refactor capture helpers or touch the other three spec files that spy on `console` but already scope correctly.

| # | File:line | Before | After |
|---|---|---|---|
| 1 | `apps/pms-core/test/observability.spec.ts:374` | `expect(capture.lines.some((l) => l.msg === 'outbox.flush')).toBe(false);` | `expect(capture.lines.some((l) => l.msg === 'outbox.flush' && l.property_id === name)).toBe(false);` |
| 2 | `apps/pms-core/test/lane-guard.spec.ts:88` | `expect(capture.lines.some((l) => l.msg === 'outbox.flush')).toBe(false);` | `expect(capture.lines.some((l) => l.msg === 'outbox.flush' && l.property_id === name)).toBe(false);` |
| 3 | `apps/pms-core/test/reservations-routes.spec.ts:295` | `expect(lines.some((l) => l.msg === 'ari.reject_on_commit')).toBe(false);` | `expect(lines.some((l) => l.msg === 'ari.reject_on_commit' && l.property_id === propertyId)).toBe(false);` |

**Rationale for #3 identifier:** `provisionHotel` binds `propertyId` (`prop_res_routes_${uuid}`). `handlePostReservations` sets `ctx.observability.propertyId` before `logAriRejectOnCommit` (`v1-dispatch.ts:1765`, `494–500`), and `@hospai/observability` emits it as `property_id` on the log line. Use `propertyId`, not `name` — this test has no `name` variable.

**Rationale for #2 variable:** the failing assertion lives in `'interactive command defers immediate outbox alarm with defer floor'`; property stub name is `const name = \`lg_defer_${crypto.randomUUID()}\`` (audit prose said `lg_backlog_…`; code uses `lg_defer_` — **`name` is the scope key**).

### Lock 2 — `test:local` script pair

**Root `package.json`** — add:

```json
"test:local": "pnpm exec turbo run test --filter=!@hospai/pms-core && node scripts/test-pms-core-shards.mjs"
```

**New file `scripts/test-pms-core-shards.mjs`** — sequential **8** shards, first failure exits non-zero, stdio inherited:

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

- **LOCKED:** `--shard=N/8` for `N = 1..8` — **not** `N/4`.
- **LOCKED:** no `--exclude` — full partition including `reservations-ledger.property.spec.ts`.
- Spawn argv must **not** insert `--` before `--shard`.

Do **not** change the existing `"test": "turbo run test"` entry.

### Lock 3 — README pre-push table

In `README.md` **"CI runs these in order (run them before pushing)"** table:

1. Replace the row command `pnpm test` → `pnpm test:local`.
2. Add immediately after the table (one sentence, normative wording):

   > `pnpm test` unsharded segfaults workerd locally; `test:local` shards pms-core 8 ways to match CI. The sold-ledger property spec runs in a separate CI job but is included in local shards.

**Do not** change other README sections in this chunk unless required for the sentence above (locked: table + sentence only).

### Lock 4 — Audit doc shard staleness

Edit `docs/audit/2026-08-15-full-codebase-audit.md`:

| Location | Change |
|---|---|
| Ground rules §3 (lines ~24–28) | Replace `--shard=1/4` example with `pnpm test:local` **or** `--shard=1/8`; note 8 shards match CI |
| **A1 Verify** block (~82–86) | Four commands → eight: `--shard=N/8` for `N=1..8` |
| **A2 Fix** bullet (~115) | `N/4` / `N=1..4` → `N/8` / `N=1..8`; mention `test:local` script name |
| **Appendix — verification commands** Tests block (~815–822) | Replace manual four-shard loop with `pnpm test:local` **or** eight `--shard=N/8` lines; remove "until A2 lands" qualifier |

---

## 3. A1 — failure mechanism (research → locked)

```
singleWorker + isolatedStorage:false
        │
        ▼
All properties share one workerd isolate + one console spy target
        │
        ▼
Property A's outbox alarm fires during Property B's capture window
        │
        ▼
Unscoped `.some(l => l.msg === 'outbox.flush')` → false positive absence failure
```

Shard assignment determines **which** pairs collide → **intermittent** CI red (audit A1).

---

## 4. A2 — developer loop (research → locked)

```
pnpm test:local
    │
    ├─► turbo run test --filter=!@hospai/pms-core   (packages + apps except pms-core)
    │
    └─► scripts/test-pms-core-shards.mjs
            │
            └─► for N in 1..8:
                    pnpm --filter @hospai/pms-core exec vitest run --shard=N/8
                    (stop on first non-zero exit; stdio inherit)
```

Matches CI shard **width** (8). Differs from CI only on ledger spec **exclusion** (documented in Lock 2 comment + README sentence).

---

## 5. Test plan

| # | Command / assertion | Expectation |
|---|---|---|
| 1 | `pnpm --filter @hospai/pms-core exec vitest run test/observability.spec.ts test/lane-guard.spec.ts test/reservations-routes.spec.ts` | Green — proves A1 fixes |
| 2 | `pnpm test:local` on a clean tree | **Long pole** — all 8 shards + non-pms-core turbo tests green. Run twice if feasible. |
| 2b | *(fallback if local runner too slow)* | #1 green **and** `for s in 1 2 3 4 5 6 7 8; do pnpm --filter @hospai/pms-core exec vitest list --shard=$s/8; done` — confirm partition covers full spec set with no empty shards |
| 3 | All 14 `check:*` gates | Green (`pnpm check:ddl` … `pnpm check:pms-core-test-dates`) |
| 4 | `pnpm typecheck` | Green |
| 5 | `pnpm build` | Green |
| 6 | `pnpm lint` | Green |

**TDD order:** apply A1 one-liners first → run #1 → land A2 script + README + audit doc edits → run #2–#6.

---

## 6. Rollback / migration notes

| Scenario | Action |
|---|---|
| A1 revert | Restore three unscoped `.some` lines — flakes return |
| A2 revert | Remove `test:local` + shard script; README table reverts to `pnpm test` |
| CI | Unchanged — this chunk does not edit `.github/workflows/ci.yml` |

---

## 7. File-level impact

| Area | Touch |
|---|---|
| `apps/pms-core/test/observability.spec.ts` | Line 374 — add `&& l.property_id === name` |
| `apps/pms-core/test/lane-guard.spec.ts` | Line 88 — add `&& l.property_id === name` |
| `apps/pms-core/test/reservations-routes.spec.ts` | Line 295 — add `&& l.property_id === propertyId` |
| `package.json` | Add `test:local` script |
| `scripts/test-pms-core-shards.mjs` | **New** — 8-shard sequential runner |
| `README.md` | Pre-push table row + one sentence |
| `docs/audit/2026-08-15-full-codebase-audit.md` | Shard count / verification path hygiene |

**Not touched:** `apps/pms-core/src/**`, `packages/**`, `vitest.config.ts`, CI workflow, migrations, `ARCHITECTURE.md`.

---

## 8. Gaps closed this chunk

| # | Gap | Closed by |
|---|---|---|
| 1 | Intermittent unscoped console absence flakes (A1) | Three property-scoped conjuncts |
| 2 | Local primary loop segfaults (A2) | `test:local` + shard script |
| 3 | README points developers at broken command | Table → `test:local` + segfault sentence |
| 4 | Audit doc stale `N/4` references | Lock 4 edits |

**Still open (explicit):**

| Item | Owner |
|---|---|
| `check:` / lint for unscoped console captures | A1 follow-up (scope-out) |
| Phase B+ audit items | Separate verticals |

---

## 9. Implementation checklist

- [x] A1: three one-line scoped absence fixes (Lock 1)
- [x] A2: `scripts/test-pms-core-shards.mjs` (8 shards, no `--exclude`, footgun comment)
- [x] A2: `package.json` `test:local`
- [x] README pre-push table + sentence (Lock 3)
- [x] Audit doc `N/4` → `N/8` / `test:local` (Lock 4)
- [x] Verify §5 commands green

---

## 10. Tree conflicts with reviewer locks

**None on heads.** This chunk is test-only + docs/scripts; catalog **89**, writers **63**, route tail `[143]`, schema **33**, night-audit steps **8** unchanged.

**Ambiguities resolved in this spec:**

| Question | Resolution |
|---|---|
| Shard count: audit says `N/4`, user lock says **8** | **8** — matches live CI; audit doc updated in Lock 4 |
| `reservations-routes` scope key: audit says "`name` in scope" | **`propertyId`** — verified via `provisionHotel` + `logWarn` → `property_id` on `ari.reject_on_commit` |
| `lane-guard` property prefix | Use in-scope **`name`** (`lg_defer_…`), not audit's `lg_backlog_…` typo |
| Local vs CI ledger spec | Local **includes** in shards; CI **excludes** + separate job — documented in Lock 2, README, §1.3 |
| README line 11 `# primary loop` still says `pnpm test` | **Out of Lock 3** — table-only change per reviewer lock; line 11 left unless a follow-up explicitly widens scope |
