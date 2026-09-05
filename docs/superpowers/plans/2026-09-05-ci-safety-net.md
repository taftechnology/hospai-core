# CI safety net (R0.13) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Approved (reviewer)
>
> **Spec/plan writers do not commit.** Implementers commit per task. Work on `main`. No push.

**Goal:** Close audit **G4**, **G5**, **G7**, **G8** (verify), **G11** (verify), **N9** — staging deploy requires green **CI** on `github.sha`; smoke on by default; web-pms `*.tsx` coverage visibility; crypto-shredding in turbo `test:coverage`; `eslint:recommended` + `@typescript-eslint/no-floating-promises` at error; honest per-package lint stubs; delete dead `preparePiiRecord` params — **without** Playwright, husky, pms-core coverage % gates, shard topology changes, or catalog/route/schema pin bumps.

**Architecture:** Task 1 lands deploy/coverage infra (G4 preflight + G5 vitest scripts). Task 2 expands ESLint baseline and fixes all new violations in-repo (no `--max-warnings` escape hatch), N9 hygiene (`preparePiiRecord` signature + 14 honest lint stubs + AGENTS note). Task 3 runs full CI, verifies G8 ratchet and G11 component tests remain green under expanded coverage, confirms pin freeze, and ticks **R0.13** only.

**Tech Stack:** GitHub Actions (`ci.yml`, `staging-deploy.yml`), vitest v8 coverage, flat ESLint 9 + `typescript-eslint`, `@hospai/crypto-shredding`, `@hospai/web-pms`.

**Spec:** `docs/superpowers/specs/2026-09-05-ci-safety-net-design.md` (Status: Approved — normative).

---

## Frozen heads (must not move)

| Pin | Value | This vertical |
|---|---|---|
| `COMMAND_CATALOG` length | **89** | **89** — unchanged |
| `V1_HTTP_ROUTE_AUDIT` | length **144**; `[143].id === 'get_city_ledger_statement'` | **144** — unchanged |
| `PROPERTY_SCHEMA_HEAD` | **34** | **34** — no migration |
| `ORG_SCHEMA_HEAD` | **9** | **9** — unchanged |
| `NIGHT_AUDIT_STEPS` | length **8**; `[3] === 'AUTO_TRANSFER'` | **8** — unchanged |
| `check:*` count | **17** (includes `check:resolve-property-prefetch` from R0.12 / G8) | **17** — verify only; no new `check:*` |

Tree verified 2026-09-05 per spec. Infra / CI / lint only — no catalog, route audit, schema, or night-audit shape change.

---

## Locked behaviour (do not re-litigate)

| Lock | Decision |
|---|---|
| **G4 CI gate** | New **`verify-ci-green`** job queries GitHub Actions for **completed success** on workflow **`CI`** / `.github/workflows/ci.yml` at **`github.sha`**. **`skip_ci_check`** input default **`false`**. Staging stays **`workflow_dispatch` only** — no auto-deploy on `workflow_run`. |
| **G4 smoke** | **`run_smoke`** boolean input default **`true`**. Resolve user id: `inputs.smoke_user_id` if non-empty, else **`vars.STAGING_SMOKE_USER_ID`**. If `run_smoke: true` and id empty → **fail fast** before deploy. Keep JWT **`::add-mask::`**, hardcoded staging `BASE`, `pnpm smoke:staging`. **No Playwright.** |
| **G5 web-pms** | `coverage.include` → `['src/**/*.ts', 'src/**/*.tsx']`; exclude both `**/*.test.ts` and `**/*.test.tsx`. **No** minimum % gate. |
| **G5 crypto-shredding** | Add `"test:coverage": "vitest run --coverage"` + minimal `vitest.config.ts` (mirror `packages/money/vitest.config.ts`). Root `@vitest/coverage-v8` already hoisted. **No** pms-core coverage collection. |
| **G7 eslint** | Stack: ignores → **`eslint.configs.recommended`** → **`typescript-eslint`** (add `typescript-eslint` root devDependency) → existing **hospai** block (11 rules unchanged). **`@typescript-eslint/no-floating-promises`: `'error'`**. **Do not** duplicate `hospai/no-id-from-name-outside-tenant-router`. |
| **G7 fix policy** | If `no-floating-promises` surfaces many violations, **fix every one in-repo** in Task 2. **Never** `--max-warnings`, disable the rule repo-wide, or leave fire-and-forget promises. Prefer `void fn()` only when intentionally fire-and-forget and documented inline. |
| **N9 preparePiiRecord** | **Delete** unused `scope` / `subjectId` from `preparePiiRecord`. Keep `(scope, subjectId, profile)` on `prepareGuestRecord`; call `preparePiiRecord(profile)` internally. **Do not** change `profileAad(piiKeyId)` wire format. |
| **N9 lint stubs** | Replace `"lint": "echo ok"` on **14** packages with `"lint": "echo 'lint via root eslint'"`. One AGENTS.md paragraph: root `pnpm lint` runs `eslint .`; per-package `lint` is turbo coordination stub. **Do not** add 14 per-package eslint configs. |
| **G8 verify** | Assert `scripts/check-resolve-property-prefetch.mjs`, `pnpm check:resolve-property-prefetch`, and CI line 37 in `.github/workflows/ci.yml` remain. **No** new ratchet logic. |
| **G11 verify** | `registration-card.test.tsx` + `front-office-editor.test.tsx` exist (R0.11) and pass; after G5 include, `.tsx` sources appear in coverage json-summary. **No Playwright.** |
| **Shards frozen** | Local `pnpm test:local` → **8** shards **including** ledger property specs. CI **8** shards **excluding** ledger + isolated `test-pms-core-ledger-prop`. **Never put `--` before `--shard`.** |
| **Pins / roadmap** | No pin bump in Tasks 1–2. Tick **R0.13** only in Task 3. |

**Out of scope:** Playwright / Cypress; husky / lint-staged (G1/G2); pms-core / PropertyDO coverage % gate; folding ledger job into matrix; reducing shards; new routes/commands/migrations; `smoke-staging.mjs` G10 COMPANY AR (R0.3); auto-deploy on `push: main`; `@hospai/observability` `"test": "echo ok"` (unchanged).

---

## Sequencing gate

```
Task 1 (G4 staging-deploy green-CI preflight + G5 coverage scripts)
→ Task 2 (G7 eslint recommended + no-floating-promises + N9 lint stub honesty + dead preparePiiRecord)
→ Task 3 (full CI + G8/G11 verify + tick R0.13)
```

**Not TDD:** No red characterization tests required — this vertical is infra/config/hygiene. Task 2 may touch many files for eslint fixes; land as one Task 2 commit (or split eslint config vs fixes only if reviewer prefers two commits within Task 2).

---

## File map (spec §9 — implementers touch these)

| File | Task | Change |
|---|---|---|
| `.github/workflows/staging-deploy.yml` | 1 | **`verify-ci-green`** job; **`run_smoke`** / **`skip_ci_check`** inputs; default smoke; user id resolution |
| `apps/web-pms/vitest.config.ts` | 1 | G5 coverage **`include` / `exclude`** |
| `packages/crypto-shredding/package.json` | 1 | **`test:coverage`** script |
| `packages/crypto-shredding/vitest.config.ts` | 1 | **New** — v8 coverage provider |
| `eslint.config.js` | 2 | **`eslint:recommended`**, **`typescript-eslint`**, **`no-floating-promises`** |
| `package.json` (root) | 2 | Add **`typescript-eslint`** devDependency |
| `packages/crypto-shredding/src/vault.ts` | 2 | **Delete** dead **`preparePiiRecord`** params |
| `apps/pms-core/src/org-do.ts` | 2 | Update **`preparePiiRecord`** call |
| `packages/crypto-shredding/src/vault.test.ts` | 2 | Update test calls |
| **14×** `package.json` | 2 | **`lint via root eslint`** stub |
| `AGENTS.md` | 2 | Lint stub paragraph; confirm **17** `check:*` unchanged |
| `DEMO-READY.md` | 1 | One line: repo var **`STAGING_SMOKE_USER_ID`** for default smoke |
| `docs/roadmap.md` | 3 | Tick **R0.13** only |

**Not touched:** `ci.yml` shard matrix (restore G8 line only if accidentally removed); `COMMAND_CATALOG`; routes; migrations; `scripts/smoke-staging.mjs` sequence.

---

## Task 1 — G4 staging deploy preflight + G5 coverage scripts

**Files:**
- Modify: `.github/workflows/staging-deploy.yml`
- Modify: `apps/web-pms/vitest.config.ts`
- Modify: `packages/crypto-shredding/package.json`
- Create: `packages/crypto-shredding/vitest.config.ts`
- Modify: `DEMO-READY.md` (one-line ops note)

**Interfaces:** none (workflow + vitest config)

### Step 1 — Restructure `staging-deploy.yml` with preflight job

Replace single `deploy` job with two jobs:

| Job | `needs` | Purpose |
|---|---|---|
| **`verify-ci-green`** | — | Fail unless **CI** succeeded on `github.sha` |
| **`deploy`** | `verify-ci-green` | Existing build / secrets / migrate / deploy / smoke |

Add workflow inputs under `workflow_dispatch`:

```yaml
inputs:
  run_smoke:
    description: 'Run post-deploy HTTP smoke (default on). Set false for deploy-only.'
    required: false
    type: boolean
    default: true
  smoke_user_id:
    description: 'Clerk user ID (user_...) to smoke as; overrides vars.STAGING_SMOKE_USER_ID when set.'
    required: false
    type: string
  skip_ci_check:
    description: 'Emergency bypass — deploy without green CI on this SHA (default false).'
    required: false
    type: boolean
    default: false
```

Add header comment documenting repo variable **`STAGING_SMOKE_USER_ID`** (Clerk `user_…` for default smoke when input empty).

- [ ] Inputs match spec §2.3

### Step 2 — Implement `verify-ci-green` job

Use `actions/github-script@v7` with `permissions: actions: read`:

```yaml
jobs:
  verify-ci-green:
    runs-on: ubuntu-latest
    if: ${{ !inputs.skip_ci_check }}
    steps:
      - name: Require green CI on this SHA
        uses: actions/github-script@v7
        with:
          script: |
            const { owner, repo } = context.repo;
            const sha = context.sha;
            const workflows = await github.rest.actions.listRepoWorkflows({ owner, repo });
            const ci = workflows.data.workflows.find(w => w.path === '.github/workflows/ci.yml' || w.name === 'CI');
            if (!ci) {
              core.setFailed('CI workflow (ci.yml) not found');
              return;
            }
            const runs = await github.rest.actions.listWorkflowRuns({
              owner, repo, workflow_id: ci.id, head_sha: sha, status: 'completed', per_page: 20,
            });
            const green = runs.data.workflow_runs.some(r => r.conclusion === 'success');
            if (!green) {
              core.setFailed(
                `No successful CI run on ${sha}. Push/merge and wait for CI green before staging deploy. ` +
                `https://github.com/${owner}/${repo}/actions`
              );
            }
```

When **`skip_ci_check: true`**, skip entire job (`if: ${{ !inputs.skip_ci_check }}`) and log in deploy job summary that CI gate was bypassed.

- [ ] Preflight fails on SHA without green CI
- [ ] Bypass works with warning

### Step 3 — Wire default smoke + user id resolution in `deploy` job

Change smoke conditions from `inputs.smoke_user_id != ''` to `inputs.run_smoke == true`.

Before mint step, resolve smoke user id:

```yaml
- name: Resolve smoke user id
  if: inputs.run_smoke == true
  id: smoke_user
  run: |
    set -euo pipefail
    INPUT="${{ inputs.smoke_user_id }}"
    VAR="${{ vars.STAGING_SMOKE_USER_ID }}"
    if [ -n "$INPUT" ]; then
      echo "id=$INPUT" >> "$GITHUB_OUTPUT"
    elif [ -n "$VAR" ]; then
      echo "id=$VAR" >> "$GITHUB_OUTPUT"
    else
      echo "::error::run_smoke=true but no smoke user id. Set repo variable STAGING_SMOKE_USER_ID or pass smoke_user_id input."
      exit 1
    fi
```

Mint step: `if: inputs.run_smoke == true`; `SMOKE_USER_ID: ${{ steps.smoke_user.outputs.id }}`. Preserve **`::add-mask::$JWT`**.

Smoke step: `if: inputs.run_smoke == true`; same `BASE` and `pnpm smoke:staging`.

- [ ] `run_smoke: false` → no mint, no smoke
- [ ] `run_smoke: true` + missing id → fail before deploy
- [ ] JWT masking preserved (N12)

### Step 4 — G5 web-pms coverage include

In `apps/web-pms/vitest.config.ts`:

```ts
coverage: {
  provider: 'v8',
  reporter: ['text', 'json-summary'],
  include: ['src/**/*.ts', 'src/**/*.tsx'],
  exclude: ['**/*.test.ts', '**/*.test.tsx', '**/dist/**'],
},
```

- [ ] Test files excluded; production `.tsx` included

### Step 5 — G5 crypto-shredding `test:coverage`

In `packages/crypto-shredding/package.json`:

```json
"test:coverage": "vitest run --coverage"
```

Create `packages/crypto-shredding/vitest.config.ts` mirroring `packages/money/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/dist/**'],
    },
  },
});
```

- [ ] Package runs under root `pnpm test:coverage` turbo graph

### Step 6 — DEMO-READY one-liner

Add under staging / deploy ops (wherever deploy is documented):

> Default staging smoke uses repo variable **`STAGING_SMOKE_USER_ID`** (Clerk `user_…`); override with workflow input **`smoke_user_id`**. Disable with **`run_smoke: false`**.

- [ ] No new ops doc

### Step 7 — Task 1 verification

```bash
pnpm --filter @hospai/web-pms exec vitest run --coverage
pnpm --filter @hospai/crypto-shredding test:coverage
```

Inspect `apps/web-pms/coverage/coverage-summary.json` (or turbo output path) — confirm `src/screens/*.tsx` keys present.

```bash
pnpm test:coverage
```

- [ ] Turbo log shows **`@hospai/web-pms`** and **`@hospai/crypto-shredding`**
- [ ] Task 1 files only; **do not** run full lint yet (Task 2)

### Step 8 — Commit (implementer)

```bash
git add .github/workflows/staging-deploy.yml \
  apps/web-pms/vitest.config.ts \
  packages/crypto-shredding/package.json \
  packages/crypto-shredding/vitest.config.ts \
  DEMO-READY.md
git commit -m "ci: R0.13 staging green-CI preflight, default smoke, coverage visibility"
```

**Manual verify (owner):** After merge + CI green on SHA, run `staging-deploy` workflow — preflight passes; with `STAGING_SMOKE_USER_ID` set, smoke runs. Attempt deploy on commit without CI → preflight fails.

---

## Task 2 — G7 ESLint baseline + N9 hygiene

**Files:**
- Modify: `eslint.config.js`
- Modify: `package.json` (root) — add `typescript-eslint`
- Modify: `packages/crypto-shredding/src/vault.ts`
- Modify: `apps/pms-core/src/org-do.ts`
- Modify: `packages/crypto-shredding/src/vault.test.ts`
- Modify: **14×** `package.json` lint stubs (see list below)
- Modify: `AGENTS.md`

**Interfaces:** `PiiVault.preparePiiRecord(profile)` — signature change only

### Step 1 — Add `typescript-eslint` dependency

```bash
pnpm add -D -w typescript-eslint
```

Match v8 line with existing `@typescript-eslint/parser` (^8.26.0).

- [ ] Lockfile updated

### Step 2 — Expand `eslint.config.js`

Target shape (order matters):

```js
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import tsParser from '@typescript-eslint/parser';
import hospai from 'eslint-plugin-hospai';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.wrangler/**', '**/coverage/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    plugins: { hospai },
    rules: {
      ...hospai.configs.recommended.rules,
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
);
```

**If** `@typescript-eslint/no-unused-vars` conflicts with hospai patterns, use `recommended` rule overrides sparingly — **do not** disable `no-floating-promises`.

**Do not** add a second `hospai/no-id-from-name-outside-tenant-router`.

- [ ] Config loads without duplicate rule errors

### Step 3 — Fix all new eslint violations

```bash
pnpm lint
```

Fix **every** error from `eslint:recommended` and `@typescript-eslint/no-floating-promises` across the repo.

Common fixes:
- Unhandled promises → `await`, `.catch(...)`, or intentional `void promise` with comment when fire-and-forget is correct (Workers alarm paths — prefer proper error handling).
- `no-undef` / `no-unused-vars` from recommended — fix or narrow with eslint-disable-next-line only when truly unavoidable (prefer code fix).

**Forbidden:** `--max-warnings`, turning `no-floating-promises` to `warn`, or disabling repo-wide.

- [ ] `pnpm lint` exits 0 with zero warnings policy (eslint default)

### Step 4 — Delete dead `preparePiiRecord` params (N9)

In `packages/crypto-shredding/src/vault.ts`:

**Before:** `async preparePiiRecord<T extends object>(scope: KeyScope, subjectId: string, profile: T)`

**After:** `async preparePiiRecord<T extends object>(profile: T)`

Update `prepareGuestRecord`:

```ts
async prepareGuestRecord(scope: KeyScope, subjectId: string, profile: GuestProfile) {
  return this.preparePiiRecord(profile);
}
```

Callers:
- `apps/pms-core/src/org-do.ts` ~1880: `await vault.preparePiiRecord(input.profile)`
- `packages/crypto-shredding/src/vault.test.ts`: `await vault.preparePiiRecord(created)`

**Do not** change `profileAad`, encrypt/decrypt AAD, or re-encrypt existing rows.

- [ ] `pnpm --filter @hospai/crypto-shredding test` green
- [ ] Grep confirms no three-arg `preparePiiRecord(` calls remain

### Step 5 — Honest lint stubs (14 packages)

Replace `"lint": "echo ok"` with `"lint": "echo 'lint via root eslint'"` in:

- `apps/pms-core`
- `packages/crypto-shredding`
- `packages/do-runtime`
- `packages/entitlement-client`
- `packages/kernel`
- `packages/money`
- `packages/observability`
- `packages/tenant-router`
- `packages/temporal-utils`
- `tooling/eslint-plugin-hospai`
- `modules/pms/inventory`
- `modules/pms/rates`
- `modules/pms/reservations`
- `modules/pms/restrictions`

Verify:

```bash
rg '"lint": "echo ok"' --glob '**/package.json'
```

- [ ] Zero matches (except do not touch `@hospai/observability` `"test": "echo ok"`)

### Step 6 — AGENTS.md lint stub note

Under **§5 Tests and CI**, add one short paragraph:

> Root **`pnpm lint`** runs **`eslint .`** on the full tree. Workspace package **`lint`** scripts are **coordination stubs** for turbo (`echo 'lint via root eslint'`) — they do not run standalone eslint. Confirm **17** `check:*` scripts unchanged (includes `check:resolve-property-prefetch` from R0.12).

- [ ] No change to check count (still **17**)

### Step 7 — Task 2 verification

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hospai/crypto-shredding test
pnpm --filter @hospai/pms-core exec vitest run test/org-do-staff.spec.ts 2>/dev/null || pnpm --filter @hospai/pms-core test -- --run org-do 2>/dev/null || true
```

Run staff/roster-related tests if present; at minimum crypto-shredding + typecheck green.

- [ ] All Task 2 changes green locally

### Step 8 — Commit (implementer)

```bash
git add eslint.config.js package.json pnpm-lock.yaml \
  packages/crypto-shredding/src/vault.ts packages/crypto-shredding/src/vault.test.ts \
  apps/pms-core/src/org-do.ts \
  apps/pms-core/package.json packages/crypto-shredding/package.json \
  packages/do-runtime/package.json packages/entitlement-client/package.json \
  packages/kernel/package.json packages/money/package.json \
  packages/observability/package.json packages/tenant-router/package.json \
  packages/temporal-utils/package.json tooling/eslint-plugin-hospai/package.json \
  modules/pms/inventory/package.json modules/pms/rates/package.json \
  modules/pms/reservations/package.json modules/pms/restrictions/package.json \
  AGENTS.md
# Include any eslint fix files from Step 3
git commit -m "chore: R0.13 eslint recommended, no-floating-promises, N9 hygiene"
```

---

## Task 3 — Full CI + G8/G11 verify + tick R0.13

**Files:**
- Modify: `docs/roadmap.md` (tick **R0.13** only)

**Interfaces:** none (verification + roadmap tick)

### Step 1 — G8 verify (prefetch ratchet)

```bash
test -f scripts/check-resolve-property-prefetch.mjs
pnpm check:resolve-property-prefetch
rg 'check:resolve-property-prefetch' .github/workflows/ci.yml package.json
```

- [ ] Script exists
- [ ] `ci.yml` `checks` job still runs `pnpm check:resolve-property-prefetch` (line ~37)
- [ ] Root `package.json` script registered
- [ ] **Do not** remove or weaken ratchet

### Step 2 — G11 verify (SPA component tests)

```bash
pnpm --filter @hospai/web-pms exec vitest run \
  src/screens/registration-card.test.tsx \
  src/screens/front-office-editor.test.tsx
```

- [ ] Both files exist (R0.11)
- [ ] Tests green
- [ ] After Task 1 coverage include, json-summary lists `registration-card.tsx` / `front-office-editor.tsx` with non-zero hits where exercised

### Step 3 — Full CI `checks` job sequence

```bash
pnpm build
pnpm --filter @hospai/pms-core exec wrangler deploy --dry-run
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
pnpm check:spa-page-chrome
pnpm check:web-pms-me-gating
pnpm check:pms-core-test-dates
pnpm check:module-manifests
pnpm check:purge
pnpm check:error-mapper-singleton
pnpm check:resolve-property-prefetch
node scripts/module-manifests-check.mjs --self-test
node scripts/purge-check.mjs --self-test
node scripts/forbidden-body-check.mjs --self-test
node scripts/do-transport-guards-check.mjs --self-test
node scripts/web-pms-colors-check.mjs --self-test
node scripts/class-resolution-check.mjs --self-test
node scripts/ui-kit-adoption-check.mjs --self-test
node scripts/spa-page-chrome-check.mjs --self-test
node scripts/property-ddl.mjs --self-test
pnpm typecheck
pnpm test:coverage
pnpm lint
```

- [ ] All **17** `check:*` green
- [ ] `test:coverage` includes web-pms + crypto-shredding
- [ ] Lint green with recommended + no-floating-promises

### Step 4 — pms-core shards (full local suite)

```bash
pnpm test:local
```

**Never put `--` before `--shard`.**

Alternative — match CI matrix exactly:

```bash
pnpm --filter @hospai/pms-core exec vitest run --shard=1/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=2/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=3/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=4/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=5/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=6/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=7/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=8/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run test/reservations-ledger.property.spec.ts test/reservations-ledger-virtual.property.spec.ts
```

- [ ] 8 CI shards + isolated ledger job pattern unchanged locally

### Step 5 — Pin freeze confirmation

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts
```

- [ ] `COMMAND_CATALOG` length **89**
- [ ] `V1_HTTP_ROUTE_AUDIT` length **144**, last id `get_city_ledger_statement`
- [ ] `PROPERTY_SCHEMA_HEAD === 34`
- [ ] `ORG_SCHEMA_HEAD === 9`
- [ ] `NIGHT_AUDIT_STEPS` length **8**, `[3] === 'AUTO_TRANSFER'`
- [ ] `check:*` count **17** — unchanged

### Step 6 — N9 / G5 grep guards

```bash
rg '"lint": "echo ok"' --glob '**/package.json'
rg 'preparePiiRecord\(' --glob '*.{ts,tsx}'
```

- [ ] No dishonest lint stubs
- [ ] `preparePiiRecord` single-arg (except `prepareGuestRecord` wrapper)

### Step 7 — Tick roadmap R0.13 only

In `docs/roadmap.md` line ~189:

```markdown
- [x] **R0.13** Audit V13 — G4, G5, G7, G8, G11, N9. deploy needs green CI SHA; web-pms `*.tsx` coverage; crypto-shredding `test:coverage`; eslint recommended; no Playwright; shard topology unchanged. G10 smoke lives in R0.3.
```

**Do not** tick R0.14 or any other item.

### Step 8 — Commit (implementer)

```bash
git add docs/roadmap.md
git commit -m "docs: tick R0.13 CI safety net"
```

If Task 3 discovers accidental G8 removal, restore in same commit before tick.

---

## Manual verify (spec §10 items 11–13 — owner)

1. **`staging-deploy`** on commit **without** CI success → **`verify-ci-green`** fails with SHA + Actions link.
2. **`staging-deploy`** with `run_smoke: true` + `STAGING_SMOKE_USER_ID` var → smoke runs after deploy; JWT masked.
3. **`run_smoke: false`** → deploy completes; no mint/smoke steps.
4. **`skip_ci_check: true`** → bypass logged; deploy proceeds (emergency only).

---

## Success criteria (spec §14 reviewer checklist)

1. **G4:** `verify-ci-green` job; **`skip_ci_check`** default false; **`run_smoke`** default true; **`STAGING_SMOKE_USER_ID`** documented; JWT masking preserved; **no Playwright**.
2. **G5:** web-pms coverage includes **`*.tsx`**; crypto-shredding **`test:coverage`** in CI turbo graph; **no** pms-core coverage % gate.
3. **G7:** **`eslint:recommended`** + **`no-floating-promises` error**; **no** duplicate idFromName rule; all violations fixed in-repo.
4. **N9:** **`preparePiiRecord`** dead params removed; **no** `"lint": "echo ok"`; AGENTS lint note.
5. **G8:** `check:resolve-property-prefetch` still in CI.
6. **G11:** registration-card + front-office-editor tests green; `.tsx` coverage visible.
7. **Shards:** 8 local inclusive; CI 8 + isolated ledger — unchanged.
8. **Pins:** catalog **89**, routes **144**, property schema **34**, org schema **9**, night audit **8**, check scripts **17**.
9. `pnpm test:local` + full CI green.

---

## PR note template

- **G8 / G11:** Verification only — R0.12 ratchet and R0.11 component tests unchanged except coverage visibility.
- **G7:** List approximate file count if eslint fixes are large; confirm no `--max-warnings`.
- **G4:** Repo admin must set **`STAGING_SMOKE_USER_ID`** before first default-smoke deploy.
- **Out:** Playwright, husky, pms-core coverage gate, shard topology change, pin bumps.
